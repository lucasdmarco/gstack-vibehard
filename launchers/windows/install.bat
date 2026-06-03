@echo off
REM gstack_vibehard Installer — Windows Launcher
REM Usage: install.bat [install|doctor|help]

where /q node
if %ERRORLEVEL% neq 0 (
    echo [gstack_vibehard] Node.js nao encontrado.
    echo [gstack_vibehard] Baixe em: https://nodejs.org/
    pause
    exit /b 1
)

if "%1"=="" (
    npx @gstack-vibehard/installer
) else (
    npx @gstack-vibehard/installer %*
)

if %ERRORLEVEL% equ 0 (
    echo [gstack_vibehard] Comando concluido.
) else (
    echo [gstack_vibehard] Erro ao executar comando.
    pause
)
