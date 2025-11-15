@echo off
echo ========================================
echo Starting ML Budget Forecasting System
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Installing Python dependencies...
python -m pip install -q -r requirements.txt
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Python dependencies
    echo Please make sure Python 3.8+ is installed
    pause
    exit /b 1
)

echo [2/2] Starting ML service on http://localhost:5001...
echo.
echo ========================================
echo ML Service is now running!
echo Press Ctrl+C to stop
echo ========================================
echo.

python budget_forecast.py
