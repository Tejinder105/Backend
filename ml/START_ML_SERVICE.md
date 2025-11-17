# Starting the ML Budget Forecast Service

## Prerequisites

1. **Python 3.8+** installed
2. **pip** package manager

## Installation Steps

### 1. Navigate to ML directory
```bash
cd Backend/ml
```

### 2. Install Python dependencies
```bash
pip install -r requirements.txt
```

Required packages:
- Flask (Web framework)
- prophet (Facebook Prophet ML model)
- pandas (Data processing)
- numpy (Numerical operations)

### 3. Start the ML service

**Option A: Direct Python (Development)**
```bash
python budget_forecast.py
```

**Option B: Using batch file (Windows)**
```bash
start_ml_service.bat
```

The service will start on `http://localhost:5001`

### 4. Verify ML service is running

Open browser or use curl:
```bash
curl http://localhost:5001/health
```

Expected response:
```json
{"status": "healthy", "service": "ML Budget Forecasting"}
```

### 5. Test with sample data
```bash
curl http://localhost:5001/test
```

## Running Both Services

**Terminal 1 - Backend API:**
```bash
cd Backend
npm run dev
```

**Terminal 2 - ML Service:**
```bash
cd Backend/ml
python budget_forecast.py
```

**Terminal 3 - Mobile App:**
```bash
cd Smart_Rent
npm start
```

## Troubleshooting

### Port already in use
If port 5001 is busy, modify `budget_forecast.py`:
```python
app.run(host='0.0.0.0', port=5002, debug=False)
```

And update Backend `.env`:
```
ML_SERVICE_URL=http://localhost:5002
```

### Prophet installation fails
Try:
```bash
pip install pystan
pip install prophet
```

Or use conda:
```bash
conda install -c conda-forge prophet
```

### Import errors
Ensure all dependencies installed:
```bash
pip install flask prophet pandas numpy
```

## Production Deployment

For production, use gunicorn:
```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5001 budget_forecast:app
```
