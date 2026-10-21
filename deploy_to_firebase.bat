@echo off
title Olodo - Deploy Lecturer Portal to Firebase Hosting
cd /d "%~dp0"
set PATH=C:\Users\User\nodejs;%APPDATA%\npm;%PATH%

echo ==========================================================
echo   OLODO LECTURER PORTAL - FIREBASE HOSTING DEPLOYMENT
echo   Target Project: brainsquard-studio-b458b
echo ==========================================================
echo.
echo [Step 1 of 2] Verifying Google authentication...
call firebase login
echo.
echo [Step 2 of 2] Uploading web portal to Firebase Hosting...
call firebase deploy --only hosting
echo.
echo ==========================================================
echo   Deployment Complete! Your portal is live at:
echo   https://brainsquard-studio-b458b.web.app
echo ==========================================================
pause
