#define AppSource GetEnv("JIANGSHUI_SOURCE")
#define OutputFolder GetEnv("JIANGSHUI_OUTPUT")
#define AppIcon GetEnv("JIANGSHUI_ICON")
[Setup]
AppId={{2876442F-4DA9-4F31-A7D6-50BD80B94AC7}
AppName=江水课表
AppVersion=1.1.9-rc1
AppPublisher=江水课表
DefaultDirName={localappdata}\Programs\JiangshuiSchedule
DefaultGroupName=江水课表
DisableDirPage=no
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyPage=no
PrivilegesRequired=lowest
OutputDir={#OutputFolder}
OutputBaseFilename=江水课表-Windows-安装包-1.1.9-rc1
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\JiangshuiSchedule.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Uninstallable=yes
[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"
[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\江水课表"; Filename: "{app}\JiangshuiSchedule.exe"; AppUserModelID: "cn.local.jiangshui.schedule"
Name: "{autodesktop}\江水课表"; Filename: "{app}\JiangshuiSchedule.exe"; AppUserModelID: "cn.local.jiangshui.schedule"
[Run]
Filename: "{app}\JiangshuiSchedule.exe"; Description: "启动江水课表"; Flags: postinstall nowait skipifsilent

