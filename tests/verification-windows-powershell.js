'use strict';
// Fixed verification-only programs. Each filesystem operand comes from guarded JSON.
const prefix = '[Console]::InputEncoding=New-Object Text.UTF8Encoding($false); [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); $ErrorActionPreference="Stop"; $d=[Console]::In.ReadToEnd()|ConvertFrom-Json; ';
const snapshot = prefix + '$d.paths | ForEach-Object {$p=$_; $a=Get-Acl -LiteralPath $p; [pscustomobject]@{path=$p;sddl=$a.Sddl;attributes=[int][IO.File]::GetAttributes($p)}} | ConvertTo-Json -Depth 3 -Compress';
const access = '$directory=([IO.File]::GetAttributes($d.path) -band [IO.FileAttributes]::Directory) -ne 0; $sections=[Security.AccessControl.AccessControlSections]"Owner,Group,Access"; $a=if($directory){[IO.Directory]::GetAccessControl($d.path,$sections)}else{[IO.File]::GetAccessControl($d.path,$sections)}; ';
const set = '; if($directory){[IO.Directory]::SetAccessControl($d.path,$a)}else{[IO.File]::SetAccessControl($d.path,$a)}';
const broad = prefix + access + '$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule("Everyone","FullControl","Allow")))' + set;
const deny = prefix + access + '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,"Write","Deny")))' + set;
const oldStoreBroad = '$ErrorActionPreference="Stop"; $d=[Console]::In.ReadToEnd()|ConvertFrom-Json; $a=Get-Acl -LiteralPath $d.file; $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule("Everyone","FullControl","Allow"))); Set-Acl -LiteralPath $d.file -AclObject $a';
module.exports = { snapshot, broad, deny, oldStoreBroad };
