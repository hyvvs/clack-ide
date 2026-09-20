#ifndef BundleDir
  #error BundleDir must point to a verified standalone runtime bundle
#endif
#ifndef OutputDir
  #error OutputDir must be provided
#endif
#ifndef BuildVersion
  #define BuildVersion "0.9.0"
#endif

[Setup]
AppId={{B0B1C830-75C1-45F1-93A6-7D503C4D765E}
AppName=Rescue Studio
AppVersion={#BuildVersion}
AppPublisher=Rescue Studio
DefaultDirName={localappdata}\Programs\Rescue Studio
DefaultGroupName=Rescue Studio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.14393
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=RescueStudio-Setup-{#BuildVersion}-win64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\Rescue Studio.exe
InfoBeforeFile={#BundleDir}\INSTALL-NOTES.txt
UninstallFilesDir={app}\uninstall
SetupLogging=yes

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Rescue Studio"; Filename: "{app}\Rescue Studio.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Rescue Studio"; Filename: "{app}\Rescue Studio.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Rescue Studio.exe"; Description: "Open Rescue Studio"; Flags: nowait postinstall skipifsilent
