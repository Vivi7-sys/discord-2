#define AppVersion "0.1.1-beta1"
[Setup]
AppId={{4BB4B743-7AF1-4D76-9CBF-F7A2C19D48A1}
AppName=Discord 2 Transmissor
AppVersion={#AppVersion}
AppPublisher=Discord 2
DefaultDirName={localappdata}\Programs\Discord2Transmissor
DefaultGroupName=Discord 2 Transmissor
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.19041
OutputDir=..\dist
OutputBaseFilename=Discord2Transmissor-{#AppVersion}-windows-x64-setup
SetupIconFile=d2.ico
UninstallDisplayIcon={app}\Discord2Transmissor.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
[Files]
Source: "..\dist\Discord2Transmissor\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Discord 2 Transmissor"; Filename: "{app}\Discord2Transmissor.exe"
[Run]
Filename: "{app}\Discord2Transmissor.exe"; Description: "Abrir Discord 2 Transmissor"; Flags: nowait postinstall skipifsilent
