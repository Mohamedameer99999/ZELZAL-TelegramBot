@echo off
chcp 65001 >nul
title ZELZAL - Google Drive Backup Setup
echo ============================================
echo  ZELZAL SECURITY - Google Drive Backup Setup
echo ============================================
echo.
echo This will configure rclone to upload backups to Google Drive.
echo You need a Google account (free).
echo.
echo Steps:
echo 1. A browser window will open for Google login
echo 2. Log in to your Google account
echo 3. Allow rclone to access your Drive
echo 4. Copy the verification code
echo 5. Paste it here
echo.
pause

set RCLONE_EXE=%~dp0rclone.exe
if not exist %RCLONE_EXE% (
    echo ERROR: rclone.exe not found in %~dp0
    pause
    exit /b 1
)

echo.
echo Creating Google Drive remote...
echo.

"%RCLONE_EXE%" config create ZELZAL_Backup drive config_is_local=false scope=drive.file

echo.
echo ============================================
if exist "%APPDATA%\rclone\rclone.conf" (
    echo ✅ Google Drive configured successfully!
    "%RCLONE_EXE%" config show ZELZAL_Backup 2>nul | findstr "type" >nul && (
        echo Remote 'ZELZAL_Backup' is ready.
        echo.
        echo Testing connection...
        "%RCLONE_EXE%" mkdir ZELZAL_Backup:ZELZAL_Backups
        "%RCLONE_EXE%" ls ZELZAL_Backup: 2>nul | findstr "ZELZAL_Backups" >nul && (
            echo ✅ Folder 'ZELZAL_Backups' created/verified on Google Drive!
        ) || (
            echo ⚠️ Could not verify folder - check connection
        )
    )
) else (
    echo ❌ Setup incomplete - rclone config not found
)
echo ============================================
echo.
echo You can now run the backup script: python backup-db.py
echo It will automatically upload to Google Drive.
echo.
pause
