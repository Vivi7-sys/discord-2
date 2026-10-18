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
 $builtHash = (Get-FileHash (Join-Path $buildRoot 'x86_64-pc-windows-msvc/release/Discord2Transmissor.exe') -Algorithm SHA256).Hash
 if ((Get-FileHash $binary -Algorithm SHA256).Hash -ne $builtHash) {throw 'Installed executable differs from the tested build'}
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
@{installed=$true;launched=$true;uninstalled=$true;legacyPayloadFound=$false;realCaptureTestedByInstallerCheck=$false} | ConvertTo-Json | Out-File -Encoding utf8 evidence/installer-check.json
