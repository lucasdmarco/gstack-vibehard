; gstack_vibehard — Windows Installer (Inno Setup)
; Copyright (c) 2026 Lucas Almeida

#define MyAppName "gstack_vibehard"
#define MyAppVersion "0.3.0"
#define MyAppPublisher "Lucas Almeida"
#define MyAppURL "https://github.com/lucasdmarco/gstack-vibehard"
#define MyAppExeName "gstack_vibehard.cmd"

[Setup]
AppId={{B3F7A2D1-9E8C-4D5F-8A7B-6C3E2F1D0A9B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={userappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=gstack_vibehard_setup_v{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
DisableDirPage=no
DisableFinishedPage=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "pt_BR"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
; Portuguese (Brazil)
pt_BR.WelcomeLabel2=Este instalador vai instalar [name] no seu sistema.%n%nRecomendado para todos os usuarios que usam Claude Code, Codex CLI ou OpenCode CLI.
pt_BR.FinishedLabelNoRun=A instalacao foi concluida com sucesso.%n%nPara comecar, execute: gstack_vibehard install
pt_BR.ConfirmUninstall=Tem certeza de que deseja remover completamente o [name] e todos os seus componentes?
pt_BR.UninstalledAll=[name] foi removido com sucesso do seu sistema.

[Tasks]
Name: "runInstall"; Description: "Executar gstack_vibehard install apos a instalacao"; GroupDescription: "Configuracao:"; Flags: checkedonce

[Dirs]
Name: "{app}\src"
Name: "{app}\hooks"
Name: "{app}\skills"
Name: "{app}\agents"
Name: "{app}\templates"
Name: "{app}\scripts"
Name: "{app}\launchers"

[Files]
Source: "..\..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\NOTICE"; DestDir: "{app}"; Flags: ignoreversion

Source: "..\..\src\*.js"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\..\src\cli\*.js"; DestDir: "{app}\src\cli"; Flags: ignoreversion
Source: "..\..\src\commands\*.js"; DestDir: "{app}\src\commands"; Flags: ignoreversion
Source: "..\..\src\harness\*.js"; DestDir: "{app}\src\harness"; Flags: ignoreversion
Source: "..\..\src\installer\*.js"; DestDir: "{app}\src\installer"; Flags: ignoreversion

Source: "..\..\hooks\hooks\*.py"; DestDir: "{app}\hooks\hooks"; Flags: ignoreversion

Source: "..\..\skills\skills\*"; DestDir: "{app}\skills\skills"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "..\..\agents\*"; DestDir: "{app}\agents"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "..\..\templates\templates\*"; DestDir: "{app}\templates\templates"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "..\..\scripts\scripts\*.ps1"; DestDir: "{app}\scripts\scripts"; Flags: ignoreversion

Source: "install.bat"; DestDir: "{app}\launchers\windows"; Flags: ignoreversion
Source: "..\..\launchers\cross\install.sh"; DestDir: "{app}\launchers\cross"; Flags: ignoreversion

; Entry point CMD wrapper
Source: "gstack_vibehard.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#MyAppName}\{#MyAppName} Shell"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "%USERPROFILE%"; Comment: "Abrir terminal com gstack_vibehard no PATH"
Name: "{userprograms}\{#MyAppName}\Desinstalar {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "install"; WorkingDir: "%USERPROFILE%"; Description: "Executar gstack_vibehard install"; Flags: postinstall skipifsilent shellexec; Tasks: runInstall

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "uninstall"; WorkingDir: "%USERPROFILE%"; Flags: runhidden

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  Path, AppDir: string;
  PathExists: Boolean;
begin
  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');

    // Add to PATH for current user
    Path := ExpandConstant('{registry:HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path|{reg:HKCU\Environment\Path}}');
    if Pos(AppDir, Path) = 0 then
    begin
      if Path <> '' then
        Path := AppDir + ';' + Path
      else
        Path := AppDir;
      RegWriteStringValue(HKCU, 'Environment', 'Path', Path);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Path, AppDir: string;
  P: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    AppDir := ExpandConstant('{app}');

    // Remove from PATH
    Path := ExpandConstant('{reg:HKCU\Environment\Path}');
    P := Pos(AppDir, Path);
    if P > 0 then
    begin
      // Remove the entry and the semicolon
      if (P > 1) and (Path[P - 1] = ';') then
        Delete(Path, P - 1, Length(AppDir) + 1)
      else if (P + Length(AppDir) <= Length(Path)) and (Path[P + Length(AppDir)] = ';') then
        Delete(Path, P, Length(AppDir) + 1)
      else
        Delete(Path, P, Length(AppDir));
      RegWriteStringValue(HKCU, 'Environment', 'Path', Path);
    end;
  end;
end;
