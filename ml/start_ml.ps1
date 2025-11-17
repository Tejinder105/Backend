# PowerShell script to start ML Budget Forecasting Service
# Run this script to start the ML service before running the backend

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ML Budget Forecasting Service Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to the ml directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Check if Python is installed
$pythonCheck = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCheck) {
    $pythonVersion = python --version 2>&1
    Write-Host "OK Python found: $pythonVersion" -ForegroundColor Green
} else {
    Write-Host "ERROR Python not found. Please install Python 3.8+" -ForegroundColor Red
    exit 1
}

# Check if port 5001 is already in use
$portCheck = netstat -ano | Select-String "5001" | Select-String "LISTENING"
if ($portCheck) {
    Write-Host "WARNING Port 5001 is already in use" -ForegroundColor Yellow
    Write-Host "ML service may already be running" -ForegroundColor Yellow
    
    # Try to test if it's our service
    try {
        $health = Invoke-RestMethod -Uri http://localhost:5001/health -Method Get -ErrorAction Stop
        if ($health.service -match "ML Budget") {
            Write-Host "OK ML service is already running and healthy!" -ForegroundColor Green
            exit 0
        }
    } catch {
        # Port is occupied by something else
    }
    
    $response = Read-Host "Do you want to stop the existing service and restart? (y/n)"
    if ($response -eq 'y') {
        $pidMatch = $portCheck | Select-String -Pattern '\d+$'
        if ($pidMatch) {
            $pid = $pidMatch.Matches.Value
            Stop-Process -Id $pid -Force
            Write-Host "OK Stopped existing service" -ForegroundColor Green
            Start-Sleep -Seconds 2
        }
    } else {
        Write-Host "Exiting..." -ForegroundColor Yellow
        exit 0
    }
}

# Check if required packages are installed
Write-Host "Checking dependencies..." -ForegroundColor Yellow
$requiredPackages = @("flask", "flask-cors", "prophet", "pandas", "numpy", "waitress")
$missingPackages = @()

foreach ($package in $requiredPackages) {
    $installed = python -m pip list 2>&1 | Select-String $package
    if (-not $installed) {
        $missingPackages += $package
    }
}

if ($missingPackages.Count -gt 0) {
    Write-Host "Installing missing packages: $($missingPackages -join ', ')" -ForegroundColor Yellow
    python -m pip install -q $($missingPackages -join ' ')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
    Write-Host "OK Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "OK All dependencies are installed" -ForegroundColor Green
}

# Start the ML service
Write-Host ""
Write-Host "Starting ML service..." -ForegroundColor Yellow
Write-Host "Service will be available at: http://localhost:5001" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C in this window to stop the service" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Start Python in a new process
$process = Start-Process python -ArgumentList "budget_forecast.py" -NoNewWindow -PassThru
Write-Host "Started Python process with PID: $($process.Id)" -ForegroundColor Gray
Start-Sleep -Seconds 3

# Verify the service started
$portCheck = netstat -ano | Select-String "5001" | Select-String "LISTENING"
if ($portCheck) {
    Write-Host "OK ML service is running on port 5001" -ForegroundColor Green
    
    # Test health endpoint
    try {
        $health = Invoke-RestMethod -Uri http://localhost:5001/health -Method Get -ErrorAction Stop
        Write-Host "OK Health check passed: $($health.status)" -ForegroundColor Green
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "ML Service is ready!" -ForegroundColor Green
        Write-Host "You can now start your backend server" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Cyan
    } catch {
        Write-Host "WARNING Service started but health check failed" -ForegroundColor Yellow
        Write-Host "It may still be initializing..." -ForegroundColor Yellow
    }
} else {
    Write-Host "ERROR Failed to start ML service" -ForegroundColor Red
    Write-Host "Check the terminal output for errors" -ForegroundColor Red
    exit 1
}
