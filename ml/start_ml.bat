@echo off
REM Simple batch script to start ML service
cd /d "%~dp0"
echo Starting ML Budget Forecasting Service...
echo.
python budget_forecast.py
pause
