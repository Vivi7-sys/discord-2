$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$install = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $install) { throw 'MSVC x64 build tools required' }
$vcvars = Join-Path $install 'VC\Auxiliary\Build\vcvars64.bat'
$build = Join-Path $PSScriptRoot '..\build\native'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$source = Join-Path $PSScriptRoot 'application_loopback.cpp'
$dll = Join-Path $build 'd2_application_loopback.dll'
Push-Location $build
try {
    # /MT avoids depending on a development-computer VC runtime installation.
    & cmd.exe /d /s /c "`"`"$vcvars`" && cl.exe /nologo /std:c++17 /EHsc /O2 /MT /W4 /DUNICODE /D_UNICODE /LD `"$source`" /link /OUT:`"$dll`" Mmdevapi.lib Ole32.lib User32.lib`""
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $dll)) { throw 'Application loopback DLL build failed' }
} finally { Pop-Location }
