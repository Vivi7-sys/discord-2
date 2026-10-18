param([string]$Binary = "", [string]$Output = "evidence/windows-native-tauri.png")
$ErrorActionPreference = 'Stop'
# Captures the actual Tauri HWND from the interactive runner desktop.
# Browser-only previews have separate filenames and are never called native evidence.
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class D2Window {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left, Top, Right, Bottom;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
}
'@
if (!$Binary) {
 $buildRoot = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'src-tauri/target' }
 $Binary = Join-Path $buildRoot 'x86_64-pc-windows-msvc/release/Discord2Transmissor.exe'
}
$exe = Resolve-Path $Binary
$process = Start-Process $exe -PassThru
try {
 $deadline = (Get-Date).AddSeconds(25)
 do { Start-Sleep -Milliseconds 250; $process.Refresh() } while ($process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline -and !$process.HasExited)
 if ($process.MainWindowHandle -eq 0) { throw 'No native Tauri window available' }
 [D2Window]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
 Start-Sleep -Seconds 2
 $rect = New-Object D2Window+Rect
 if (![D2Window]::GetWindowRect($process.MainWindowHandle, [ref]$rect)) { throw 'Cannot read native window bounds' }
 $bitmap = [System.Drawing.Bitmap]::new(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
 $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
 try {
  $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size)
  New-Item -ItemType Directory -Force evidence | Out-Null
  $bitmap.Save((Join-Path (Get-Location) $Output),[System.Drawing.Imaging.ImageFormat]::Png)
 } finally {$graphics.Dispose();$bitmap.Dispose()}
} finally {if (!$process.HasExited) {$process.CloseMainWindow() | Out-Null; if (!$process.WaitForExit(15000)) {$process.Kill()}}}
