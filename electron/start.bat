@echo off

REM Change to project root directory
cd /d "%~dp0\.."

echo 🚀 Starting PigeonFS Electron App...
echo.
echo 📦 Building web app...
call npm run build

if %errorlevel% equ 0 (
    echo.
    echo ✅ Build complete!
    echo 🖥️  Launching Electron...
    echo.
    call electron .
) else (
    echo.
    echo ❌ Build failed. Please fix the errors and try again.
    exit /b 1
)
