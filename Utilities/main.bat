@echo off
echo Starting Daily Test Case Execution...
echo Current Directory: %CD%
echo Timestamp: %DATE% %TIME%
echo.

REM Check if Node.js is available
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Run the daily test runner

git stash
git pull

cd ..
node main.js


echo.
echo Daily test execution completed!
echo Check daily-test-log.txt and %APPDATA%\cline-Remote\Cases\report.html for detailed results.
echo.
pause