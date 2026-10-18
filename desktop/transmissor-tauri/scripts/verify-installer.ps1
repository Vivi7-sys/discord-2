$ErrorActionPreference = 'Stop'
$buildRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'src-tauri/target' }
$installers = @(Get-ChildItem (Join-Path $buildRoot 'x86_64-pc-windows-msvc/release/bundle/nsis/*.exe'))
if ($installers.Count -ne 1) {throw 'Expected exactly one test installer'}
$target = Join-Path $env:RUNNER_TEMP ("D2RustInstaller-" + [guid]::NewGuid().ToString('N'))
$installer = Start-Process $installers[0].FullName -ArgumentList @('/S',"/D=$target") -Wait -PassThru
if ($installer.ExitCode -ne 0) {throw 'NSIS installation failed'}
$uninstaller = Join-Path $target 'uninstall.exe'
try {
 $binary = Join-Path $target 'Discord2Transmissor.exe'
 if (!(Test-Path $binary)) {throw 'Installed application not found'}
 # Tauri 2.12 patches UNK -> NSS before NSIS, then restores the build output.
 # Compare the entire installed payload against that exact documented patch.
 $builtBytes = [IO.File]::ReadAllBytes((Join-Path $buildRoot 'x86_64-pc-windows-msvc/release/Discord2Transmissor.exe'))
 $builtHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($builtBytes))
 $marker = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_NSS')
 $offset = [Text.Encoding]::ASCII.GetString($builtBytes).IndexOf('__TAURI_BUNDLE_TYPE_VAR_UNK', [StringComparison]::Ordinal)
 if ($offset -lt 0) {throw 'Expected unpatched Tauri bundle marker missing'}
 [Array]::Copy($marker, 0, $builtBytes, $offset, $marker.Length)
 $expectedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($builtBytes))
 $installedHash = (Get-FileHash $binary -Algorithm SHA256).Hash
 if ($installedHash -ne $expectedHash) {throw 'Installed executable differs beyond the expected Tauri NSIS marker patch'}
 $legacy = @(Get-ChildItem $target -Recurse -File | Where-Object {$_.Name -match '^(python.*\.dll|.*\.py[co]?|Qt[56].*\.dll|PySide.*)$'})
 if ($legacy.Count -ne 0) {throw 'Legacy Python or Qt payload found'}
 ./scripts/windows-screenshot.ps1 -Binary $binary -Output 'evidence/windows-installed-tauri.png'
} finally {
 if (Test-Path $uninstaller) {
  $remove = Start-Process $uninstaller -ArgumentList '/S' -Wait -PassThru
  if ($remove.ExitCode -ne 0) {throw 'NSIS uninstall failed'}
 }
}
if (Test-Path (Join-Path $target 'Discord2Transmissor.exe')) {throw 'Installed binary remains after uninstall'}
@{installed=$true;launched=$true;uninstalled=$true;legacyPayloadFound=$false;builtSha256=$builtHash;expectedNsisPayloadSha256=$expectedHash;installedSha256=$installedHash;tauriBundleMarkerPatch="UNK -> NSS";realCaptureTestedByInstallerCheck=$false} | ConvertTo-Json | Out-File -Encoding utf8 evidence/installer-check.json
