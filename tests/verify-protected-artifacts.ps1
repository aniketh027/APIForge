param([string]$Manifest = "$env:TEMP\apiforge-v1-protected-manifest.json")
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$roots = @('APIForge_Drive_Resources.zip', 'APIForge_Drive_Resources', 'APIForge_Overleaf_Source', 'APIForge_Overleaf_Source__FINAL.zip')
$files = foreach ($root in $roots) { Get-ChildItem -LiteralPath (Join-Path $repoRoot $root) -File -Recurse -Force }
$current = @($files | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
        size = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower()
        created = $_.CreationTimeUtc.ToString('o')
        modified = $_.LastWriteTimeUtc.ToString('o')
    }
})
$baseline = @(Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json)
if ($baseline.Count -ne 36 -or $current.Count -ne 36) { throw 'Protected inventory must contain exactly 36 files.' }
for ($i = 0; $i -lt $baseline.Count; $i++) {
    foreach ($property in @('path', 'size', 'sha256', 'created', 'modified')) {
        $expected = $baseline[$i].$property
        if ($expected -is [datetime]) { $expected = $expected.ToUniversalTime().ToString('o') }
        if ([string]$expected -cne [string]$current[$i].$property) {
            throw "Protected change: $($baseline[$i].path), $property, expected $($baseline[$i].$property), observed $($current[$i].$property)"
        }
    }
}
Write-Output 'Protected integrity PASS: 36 paths, sizes, SHA-256, creation and modification timestamps unchanged.'
