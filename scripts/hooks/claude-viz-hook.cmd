@echo off
setlocal
if "%CLAUDE_VIZ_EVENTS_FILE%"=="" set CLAUDE_VIZ_EVENTS_FILE=%USERPROFILE%\.claude-viz\events.jsonl
for %%I in ("%CLAUDE_VIZ_EVENTS_FILE%") do set DIR=%%~dpI
if not exist "%DIR%" mkdir "%DIR%" >nul 2>&1

more >> "%CLAUDE_VIZ_EVENTS_FILE%"
exit /b 0
