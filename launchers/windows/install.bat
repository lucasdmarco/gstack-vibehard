@echo off
REM GStack VibeHard Installer — Windows Launcher
REM Usage: install.bat [install|doctor|help]

where /q node
if %ERRORLEVEL% neq 0 (
    echo [GStack] Node.js nao encontrado.
    echo [GStack] Baixe em: https://nodejs.org/
    pause
    exit /b 1
)

if "%1"=="" (
    npx @gstack/installer
) else (
    npx @gstack/installer %*
)

if %ERRORLEVEL% equ 0 (
    echo [GStack] Comando concluido.
) else (
    echo [GStack] Erro ao executar comando.
    pause
)
