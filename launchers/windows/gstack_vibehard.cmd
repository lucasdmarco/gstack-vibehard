@echo off
REM gstack_vibehard — CLI entry point for Windows
REM This file is installed by the Inno Setup installer.

node "%~dp0src\index.js" %*
