# Fixed repository code. Request data arrives as JSON stdin, never shell syntax.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
function Refuse([string]$Code) { throw $Code }
function Map-Mask([int64]$Mask) {
    $m = $Mask -band 4294967295
    $result = $m -band 268435455
    if ($m -band 2147483648) { $result = $result -bor 1179785 }
    if ($m -band 1073741824) { $result = $result -bor 1179926 }
    if ($m -band 536870912) { $result = $result -bor 1179808 }
    if ($m -band 268435456) { $result = $result -bor 2032127 }
    if ($result -band (-bnot 2032127)) { Refuse 'BOOTSTRAP_UNSUPPORTED_ACL' }
    return $result
}
function Check-Entry([string]$Path, [string]$Kind) {
    $attributes = [IO.File]::GetAttributes($Path)
    # No reparse, encrypted, compressed, device or offline entries.
    if ([int]$attributes -band 23616) { Refuse 'BOOTSTRAP_UNSAFE_PATH' }
    $directory = ([int]$attributes -band 16) -ne 0
    if (($Kind -eq 'marker') -eq $directory) { Refuse 'BOOTSTRAP_UNSAFE_PATH' }
    $sections = [Security.AccessControl.AccessControlSections]'Owner,Group,Access'
    if ($directory) { $acl = [IO.Directory]::GetAccessControl($Path, $sections) }
    else { $acl = [IO.File]::GetAccessControl($Path, $sections) }
    $raw = New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(), 0)
    Check-Descriptor $raw $acl.AreAccessRulesCanonical $acl.AreAccessRulesProtected $Kind
    return [pscustomobject]@{path=$Path; owner=$raw.Owner.Value; sddl=$acl.GetSecurityDescriptorSddlForm($sections)}
}
function Check-Descriptor($Raw, [bool]$Canonical, [bool]$Protected, [string]$Kind) {
    if (-not $raw.Owner -or -not $raw.Group -or -not $raw.DiscretionaryAcl -or -not $Canonical) {
        Refuse 'BOOTSTRAP_UNSUPPORTED_ACL'
    }
    $private = $Kind -ne 'ancestor'
    if ($private -and $raw.Owner.Value -ne $script:sid.Value) { Refuse 'BOOTSTRAP_UNSAFE_OWNER' }
    if (-not $private -and $raw.Owner.Value -notin $script:ancestorTrusted) { Refuse 'BOOTSTRAP_UNSAFE_OWNER' }
    if ($Kind -eq 'root' -and -not $Protected) { Refuse 'BOOTSTRAP_UNSAFE_ACL' }
    $userMask = 0
    $seen = @()
    foreach ($ace in $raw.DiscretionaryAcl) {
        if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.OpaqueLength -ne 0 -or
            ([int]$ace.AceFlags -band (-bnot 31))) { Refuse 'BOOTSTRAP_UNSUPPORTED_ACL' }
        if ($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessDenied) { Refuse 'BOOTSTRAP_ACCESS_DENIED' }
        if ($ace.AceQualifier -ne [Security.AccessControl.AceQualifier]::AccessAllowed) { Refuse 'BOOTSTRAP_UNSUPPORTED_ACL' }
        $mask = Map-Mask $ace.AccessMask
        $id = $ace.SecurityIdentifier.Value
        $effective = ([int]$ace.AceFlags -band 8) -eq 0
        if ($private) {
            # An exact small allowlist, never trust other groups/capabilities.
            if ($id -notin $script:privateTrusted -or $mask -ne 2032127) { Refuse 'BOOTSTRAP_UNSAFE_ACL' }
            $expectedFlags = if ($Kind -eq 'root') { 3 } else { 16 }
            if ([int]$ace.AceFlags -ne $expectedFlags -or $id -in $seen) { Refuse 'BOOTSTRAP_UNSUPPORTED_ACL' }
            $seen += $id
        } elseif ($effective -and $id -notin $script:ancestorTrusted -and ($mask -band 852306)) {
            # DELETE, DELETE_CHILD, WRITE_DAC, WRITE_OWNER, WRITE_DATA/EA/ATTRIBUTES.
            Refuse 'BOOTSTRAP_UNSAFE_ANCESTOR'
        }
        if ($effective -and $id -eq $script:sid.Value) { $userMask = $userMask -bor $mask }
    }
    if ($private -and ($seen.Count -ne 3 -or $userMask -ne 2032127)) { Refuse 'BOOTSTRAP_UNSAFE_ACL' }
}
function Check-Ancestors([string]$Root) {
    $items = @()
    $p = [IO.Directory]::GetParent($Root)
    while ($p) {
        if (-not [IO.Directory]::Exists($p.FullName)) { Refuse 'BOOTSTRAP_PARENT_MISSING' }
        $items += Check-Entry $p.FullName 'ancestor'
        $p = $p.Parent
    }
    return $items
}
function Create-PrivateDirectory([string]$Root) {
    # One in-memory P/Invoke declaration; no Add-Type, compiler or temporary DLL.
    $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName('APIForgeBootstrap')), [Reflection.Emit.AssemblyBuilderAccess]::Run)
    $module = $assembly.DefineDynamicModule('Native')
    $type = $module.DefineType('APIForgeBootstrapNative', [Reflection.TypeAttributes]'Public,Sealed,Abstract')
    $method = $type.DefineMethod('CreateDirectoryW', [Reflection.MethodAttributes]'Public,Static,PinvokeImpl', [bool], [Type[]]@([string],[IntPtr]))
    $attributeType = [Runtime.InteropServices.DllImportAttribute]
    $attribute = New-Object Reflection.Emit.CustomAttributeBuilder($attributeType.GetConstructor([Type[]]@([string])),
        [object[]]@('kernel32.dll'), [Reflection.FieldInfo[]]@($attributeType.GetField('SetLastError'),$attributeType.GetField('ExactSpelling'),$attributeType.GetField('CharSet'),$attributeType.GetField('CallingConvention')),
        [object[]]@($true,$true,[Runtime.InteropServices.CharSet]::Unicode,[Runtime.InteropServices.CallingConvention]::Winapi))
    $method.SetCustomAttribute($attribute)
    $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
    # Capture the P/Invoke last-error cache before PowerShell's binder runs again.
    $wrapper = $type.DefineMethod('CreateResult', [Reflection.MethodAttributes]'Public,Static', [int], [Type[]]@([string],[IntPtr]))
    $il = $wrapper.GetILGenerator()
    $success = $il.DefineLabel()
    $il.Emit([Reflection.Emit.OpCodes]::Ldarg_0)
    $il.Emit([Reflection.Emit.OpCodes]::Ldarg_1)
    $il.Emit([Reflection.Emit.OpCodes]::Call, $method)
    $il.Emit([Reflection.Emit.OpCodes]::Brtrue, $success)
    $il.Emit([Reflection.Emit.OpCodes]::Call, [Runtime.InteropServices.Marshal].GetMethod('GetLastWin32Error'))
    $nativeFailure = $il.DefineLabel()
    $il.Emit([Reflection.Emit.OpCodes]::Dup)
    $il.Emit([Reflection.Emit.OpCodes]::Brtrue, $nativeFailure)
    $il.Emit([Reflection.Emit.OpCodes]::Pop)
    $il.Emit([Reflection.Emit.OpCodes]::Ldc_I4_M1)
    $il.MarkLabel($nativeFailure)
    $il.Emit([Reflection.Emit.OpCodes]::Ret)
    $il.MarkLabel($success)
    $il.Emit([Reflection.Emit.OpCodes]::Ldc_I4_0)
    $il.Emit([Reflection.Emit.OpCodes]::Ret)
    $native = $type.CreateType()
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetOwner($script:sid)
    $acl.SetGroup($script:sid)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($id in $script:privateTrusted) {
        $principal = New-Object Security.Principal.SecurityIdentifier($id)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal, [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    $bytes = $acl.GetSecurityDescriptorBinaryForm()
    $pin = [Runtime.InteropServices.GCHandle]::Alloc($bytes, [Runtime.InteropServices.GCHandleType]::Pinned)
    $sa = [Runtime.InteropServices.Marshal]::AllocHGlobal(24)
    try {
        # Windows x64 SECURITY_ATTRIBUTES: DWORD length, padding, pointer, BOOL.
        for ($i=0; $i -lt 24; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($sa, $i, 0) }
        [Runtime.InteropServices.Marshal]::WriteInt32($sa, 0, 24)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($sa, 8, $pin.AddrOfPinnedObject())
        $errorCode = $native::CreateResult($Root, $sa)
        if ($errorCode -ne 0) {
            if ($errorCode -eq 183) { Refuse 'BOOTSTRAP_ROOT_EXISTS' }
            if ($errorCode -eq 5) { Refuse 'BOOTSTRAP_ACCESS_DENIED' }
            Refuse 'BOOTSTRAP_STORAGE_FAILURE'
        }
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($sa)
        $pin.Free()
    }
}
try {
    if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1 -or
        [IntPtr]::Size -ne 8 -or [Environment]::OSVersion.Version.Major -ne 10 -or
        $ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { Refuse 'BOOTSTRAP_HELPER_UNAVAILABLE' }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $script:sid = $identity.User
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $script:sid -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Refuse 'BOOTSTRAP_ELEVATED' }
    $script:privateTrusted = @($script:sid.Value, 'S-1-5-18', 'S-1-5-32-544')
    $script:ancestorTrusted = $script:privateTrusted + 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
    $request = [Console]::In.ReadToEnd() | Microsoft.PowerShell.Utility\ConvertFrom-Json
    $profile = [Environment]::GetFolderPath('UserProfile')
    $localData = [Environment]::GetFolderPath('LocalApplicationData')
    $root = if ($request.root) { [string]$request.root } else { [IO.Path]::Combine($localData, 'APIForge-ProjectStore') }
    if (-not $profile -or -not $localData -or -not $root.StartsWith($profile+'\', [StringComparison]::OrdinalIgnoreCase)) { Refuse 'BOOTSTRAP_UNSAFE_LOCATION' }
    if ($request.action -eq 'resolve') {
        [pscustomobject]@{ok=$true;root=$root;ownerSid=$script:sid.Value} | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
        exit 0
    }
    $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot($root))
    if (-not $drive.IsReady -or $drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { Refuse 'BOOTSTRAP_UNSUPPORTED_VOLUME' }
    $ancestors = @(Check-Ancestors $root)
    if ($request.action -eq 'initialize') { Create-PrivateDirectory $root }
    elseif ($request.action -notin @('verifyRoot','verifyMarker')) { Refuse 'BOOTSTRAP_INVALID_OPTIONS' }
    $entry = Check-Entry $root 'root'
    if ($request.action -eq 'verifyMarker') {
        $marker = Check-Entry ([IO.Path]::Combine($root,'bootstrap.identity.json')) 'marker'
    }
    # Recheck after creation. These checks detect change within the admitted namespace.
    $after = @(Check-Ancestors $root)
    if (($ancestors | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress) -ne ($after | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress)) { Refuse 'BOOTSTRAP_IDENTITY_MISMATCH' }
    [pscustomobject]@{ok=$true;root=$root;ownerSid=$script:sid.Value;entry=$entry;ancestors=$after;marker=$marker} | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 5 -Compress
} catch {
    $code = $_.Exception.Message
    if ($code -notmatch '^BOOTSTRAP_[A-Z_]+$') { $code = 'BOOTSTRAP_SECURITY_CHECK_FAILED' }
    [pscustomobject]@{ok=$false;code=$code} | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
    exit 1
}
