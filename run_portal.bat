@echo off
title Olodo Lecturer Portal Server
cd /d "%~dp0"
echo ==========================================================
echo Starting Olodo Lecturer Portal on http://localhost:8080/
echo ==========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
