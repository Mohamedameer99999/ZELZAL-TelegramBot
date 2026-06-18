@echo off
chcp 65001 >nul
title ZELZAL - Server Deployment Package
echo ============================================
echo  ZELZAL SECURITY - Bot Deployment Package
echo ============================================
echo.
echo This script packages the bot for deployment to a VPS/server.
echo.
echo Choose your target:
echo  1) Railway.app (easy, has free tier)
echo  2) DigitalOcean / any Linux VPS
echo  3) Show instructions only
echo.

set /p CHOICE="Enter choice (1/2/3): "

if "%CHOICE%"=="1" goto railway
if "%CHOICE%"=="2" goto vps
if "%CHOICE%"=="3" goto help
echo Invalid choice
pause
exit /b

:railway
echo.
echo === Packaging for Railway.app ===
echo.
echo Railway connects directly to your GitHub repo.
echo Just push the Telegram-Bot repo to GitHub and connect it.
echo.
echo Required setup in Railway:
echo  - Start command: node bot.js
echo  - Add Config Variables from config.json
echo  - Add persistent volume for zelzal.db
echo.
echo Ready to deploy! Push to GitHub and connect at railway.app
pause
exit /b

:vps
echo.
echo === Packaging for Linux VPS ===
echo.
set DEPLOY_DIR=%~dp0deploy
if exist %DEPLOY_DIR% rmdir /s /q %DEPLOY_DIR%
mkdir %DEPLOY_DIR%

echo Copying files...
xcopy /E /I /Q "%~dp0*.js" "%DEPLOY_DIR%\" >nul
xcopy /E /I /Q "%~dp0*.json" "%DEPLOY_DIR%\" >nul
xcopy /E /I /Q "%~dp0public" "%DEPLOY_DIR%\public\" >nul
if exist "%~dp0package.json" copy "%~dp0package.json" "%DEPLOY_DIR%\" >nul

echo Creating deploy.zip...
cd %DEPLOY_DIR%
powershell -Command "Compress-Archive -Path * -DestinationPath '%~dp0zelzal-bot-deploy.zip' -Force"
cd %~dp0

echo.
echo ✅ Created: zelzal-bot-deploy.zip
echo.
echo === VPS Deployment Instructions ===
echo 1. Upload deploy.zip to your VPS
echo 2. Run these commands:
echo.
echo    unzip zelzal-bot-deploy.zip -d zelzal-bot
echo    cd zelzal-bot
echo    npm install
echo    cp config.example.json config.json
echo    nano config.json  # Add your tokens
echo    npm install -g pm2
echo    pm2 start bot.js --name zelzal-bot
echo    pm2 start remote-server.js --name zelzal-api
echo    pm2 save
echo    pm2 startup
echo.
echo 3. Open port 3456 in your VPS firewall
echo 4. Your bot is live!
echo.

rmdir /s /q %DEPLOY_DIR%
pause
exit /b

:help
echo.
echo === Deployment Guide ===
echo.
echo ZELZAL Bot needs a 24/7 server. Options:
echo.
echo 1) Railway.app (FREE tier available)
echo    - Connect GitHub repo → auto deploys
echo    - Start cmd: node bot.js
echo    - Needs persistent volume for SQLite DB
echo.
echo 2) DigitalOcean App Platform ($5-12/month)
echo    - Similar to Railway, more control
echo.
echo 3) VPS (DigitalOcean Droplet, $6/month)
echo    - Full control: Ubuntu + Node.js + PM2
echo    - Run multiple services (bot + API + auto-responder)
echo.
echo 4) PythonAnywhere ($5/month)
echo    - Has Node.js support
echo    - Limited but simple
echo.
echo What do you prefer? Your choice determines the setup.
echo.
pause
exit /b
