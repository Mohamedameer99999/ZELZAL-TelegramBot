@echo off
chcp 65001 >nul
echo ============================================
echo  ZELZAL Tunnel - Serveo.net
echo ============================================
echo.

set LOGFILE=%~dp0tunnel.log
set URLFILE=%~dp0tunnel-url.txt
set PIDFILE=%~dp0tunnel.pid

:: Kill old tunnel
if exist %PIDFILE% (
  set /p OLDPID=<%PIDFILE%
  taskkill /F /PID %OLDPID% >nul 2>&1
  timeout /t 2 /nobreak >nul
)

echo Starting tunnel on port 3456...
echo This may take a few seconds...
echo.

:: Start SSH in background
start /B "" ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3456 serveo.net > "%LOGFILE%" 2>&1

:: Wait and get URL
timeout /t 10 /nobreak >nul

:: Try to extract URL from log
for /f "tokens=*" %%a in ('findstr "https://" "%LOGFILE%"') do set TUNNEL_URL=%%a
if defined TUNNEL_URL (
  echo %TUNNEL_URL%> "%URLFILE%"
  echo.
  echo ============================================
  echo  Tunnel Active!
  echo  URL: %TUNNEL_URL%
  echo ============================================
  echo.
  echo  Admin:     %TUNNEL_URL%/app/admin.html
  echo  Portal:    %TUNNEL_URL%/app/portal.html
  echo  Site:      %TUNNEL_URL%/
  echo.
) else (
  echo Could not get tunnel URL yet.
  echo Check %LOGFILE% for details.
)

:: Get PID of ssh process
for /f "tokens=2" %%a in ('tasklist /fi "imagename eq ssh.exe" /fo list ^| findstr "PID:"') do set SSHPID=%%a
if defined SSHPID (
  echo %SSHPID%> "%PIDFILE%"
  echo Tunnel PID: %SSHPID%
)

echo.
echo Tunnel running in background.
echo Close this window to stop the tunnel? No - tunnel keeps running.
echo To stop: taskkill /F /PID %SSHPID%
pause
