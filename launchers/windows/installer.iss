; GStack VibeHard — Inno Setup installer for Windows
; Compile with Inno Setup 6+

#define MyAppName "GStack VibeHard"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "GStack"
#define MyAppURL "https://github.com/anomalyco/gstack-vibehard"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={userappdata}\GStack
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=GStackInstaller-{#MyAppVersion}
SetupIconFile=..\..\assets\icon.ico
UninstallDisplayIcon={app}\icon.ico
Compression=lzma
SolidCompression=yes

[Languages]
Name: "portuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: claude; Description: "Configure Claude Code"
Name: codex; Description: "Configure OpenAI Codex CLI"
Name: opencode; Description: "Configure OpenCode CLI"

[Files]
Source: "..\..\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs
Source: "..\..\hooks\*"; DestDir: "{app}\hooks"; Flags: ignoreversion recursesubdirs
Source: "..\..\skills\*"; DestDir: "{app}\skills"; Flags: ignoreversion recursesubdirs
Source: "..\..\agents\*"; DestDir: "{app}\agents"; Flags: ignoreversion recursesubdirs
Source: "..\..\templates\*"; DestDir: "{app}\templates"; Flags: ignoreversion recursesubdirs
Source: "..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "cmd.exe"; Parameters: "/c npm install -g @gstack/installer"; Description: "Install npm package"; StatusMsg: "Installing npm package..."
Filename: "cmd.exe"; Parameters: "/c npx @gstack/installer install"; Description: "Run installer"; StatusMsg: "Configuring your environment..."; Flags: postinstall

[UninstallRun]
Filename: "cmd.exe"; Parameters: "/c npm uninstall -g @gstack/installer"
