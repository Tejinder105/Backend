from flask import Flask, request, jsonify
from prophet import Prophet
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging
import warnings

# Suppress Prophet warnings
warnings.filterwarnings('ignore')
logging.getLogger('prophet').setLevel(logging.WARNING)

app = Flask(__name__)

def prepare_data(historical_data):
    """
    Convert historical spending data to Prophet format
    Args:
        historical_data: [{"month": "2025-11", "spent": 15000}, ...]
    Returns:
        DataFrame with 'ds' (date) and 'y' (value) columns
    """
    if not historical_data or len(historical_data) == 0:
        return None
    
    # Convert to daily data points (Prophet works better with more data points)
    daily_data = []
    for entry in historical_data:
        month_date = datetime.strptime(entry['month'], '%Y-%m')
        # Distribute spending evenly across month days
        days_in_month = (month_date.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        days_count = days_in_month.day
        daily_amount = entry['spent'] / days_count
        
        for day in range(days_count):
            date = month_date + timedelta(days=day)
            daily_data.append({
                'ds': date,
                'y': daily_amount
            })
    
    df = pd.DataFrame(daily_data)
    return df

def train_prophet_model(df):
    """
    Train Prophet model on historical data
    """
    if df is None or len(df) < 10:
        return None
    
    # Initialize Prophet with reasonable parameters for budget forecasting
    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=False,
        daily_seasonality=False,
        changepoint_prior_scale=0.05,  # Less sensitive to changes
        seasonality_prior_scale=10.0,  # Moderate seasonality
        interval_width=0.8  # 80% confidence interval
    )
    
    model.fit(df)
    return model

def aggregate_daily_to_monthly(forecast_df):
    """
    Aggregate daily predictions to monthly totals
    """
    forecast_df['month'] = forecast_df['ds'].dt.to_period('M')
    monthly = forecast_df.groupby('month').agg({
        'yhat': 'sum',
        'yhat_lower': 'sum',
        'yhat_upper': 'sum'
    }).reset_index()
    monthly['month'] = monthly['month'].astype(str)
    return monthly

def calculate_confidence(yhat, yhat_lower, yhat_upper):
    """
    Calculate confidence level based on prediction interval width
    """
    interval_width = (yhat_upper - yhat_lower) / yhat
    
    if interval_width < 0.2:  # Within 20%
        return 'high'
    elif interval_width < 0.4:  # Within 40%
        return 'medium'
    else:
        return 'low'

def detect_trend(historical_data):
    """
    Detect spending trend from historical data
    """
    if len(historical_data) < 2:
        return 'stable'
    
    recent = historical_data[0]['spent']
    older = historical_data[-1]['spent']
    change_percent = ((recent - older) / older) * 100
    
    if change_percent > 15:
        return 'increasing'
    elif change_percent < -15:
        return 'decreasing'
    else:
        return 'stable'

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'service': 'ML Budget Forecasting'}), 200

@app.route('/predict', methods=['POST'])
def predict():
    """
    Main prediction endpoint
    
    Request body:
    {
        "historicalData": [
            {"month": "2025-11", "spent": 15000},
            {"month": "2025-10", "spent": 18000},
            ...
        ],
        "currentMonthSpent": 12000,
        "daysPassedInMonth": 15,
        "totalDaysInMonth": 30,
        "monthlyBudget": 20000,
        "forecastMonths": 3
    }
    """
    try:
        data = request.get_json()
        
        if not data or 'historicalData' not in data:
            return jsonify({'error': 'Missing historicalData'}), 400
        
        historical_data = data['historicalData']
        current_month_spent = data.get('currentMonthSpent', 0)
        days_passed = data.get('daysPassedInMonth', 1)
        total_days = data.get('totalDaysInMonth', 30)
        monthly_budget = data.get('monthlyBudget', 0)
        forecast_months = data.get('forecastMonths', 3)
        
        # Minimum data requirement
        if len(historical_data) < 2:
            return jsonify({
                'error': 'Insufficient historical data',
                'message': 'Need at least 2 months of data for ML prediction'
            }), 400
        
        # Prepare data for Prophet
        df = prepare_data(historical_data)
        
        if df is None:
            return jsonify({'error': 'Failed to prepare data'}), 500
        
        # Train model
        model = train_prophet_model(df)
        
        if model is None:
            return jsonify({'error': 'Failed to train model'}), 500
        
        # Generate future dates for prediction (next N months)
        last_date = df['ds'].max()
        future_days = forecast_months * 30 + 15  # Extra days for accuracy
        future = model.make_future_dataframe(periods=future_days, freq='D')
        
        # Make predictions
        forecast = model.predict(future)
        
        # Get only future predictions
        future_forecast = forecast[forecast['ds'] > last_date]
        
        # Aggregate to monthly
        monthly_forecast = aggregate_daily_to_monthly(future_forecast)
        
        # Extract predictions for next N months
        predictions = []
        for i in range(min(forecast_months, len(monthly_forecast))):
            month_data = monthly_forecast.iloc[i]
            confidence = calculate_confidence(
                month_data['yhat'],
                month_data['yhat_lower'],
                month_data['yhat_upper']
            )
            
            predictions.append({
                'month': month_data['month'],
                'predictedAmount': max(0, round(month_data['yhat'], 2)),
                'lowerBound': max(0, round(month_data['yhat_lower'], 2)),
                'upperBound': round(month_data['yhat_upper'], 2),
                'confidence': confidence
            })
        
        # Next month prediction (most important)
        next_month = predictions[0] if predictions else None
        
        # Current month projection using ML + daily rate
        daily_rate = current_month_spent / max(days_passed, 1)
        simple_projection = daily_rate * total_days
        
        # Use Prophet to predict end of current month
        remaining_days = total_days - days_passed
        current_month_end = datetime.now().replace(day=1) + timedelta(days=total_days)
        
        # Create future dataframe for remaining days
        current_future = pd.DataFrame({
            'ds': pd.date_range(start=datetime.now(), periods=remaining_days, freq='D')
        })
        current_forecast = model.predict(current_future)
        remaining_spending = current_forecast['yhat'].sum()
        
        # ML-based projection
        ml_projection = current_month_spent + max(0, remaining_spending)
        
        # Weighted average (70% ML, 30% simple rate)
        final_projection = (0.7 * ml_projection) + (0.3 * simple_projection)
        
        # Over-budget detection
        is_likely_over_budget = final_projection > monthly_budget if monthly_budget > 0 else False
        budget_difference = final_projection - monthly_budget if monthly_budget > 0 else 0
        
        # Calculate overall confidence based on data quantity
        data_months = len(historical_data)
        if data_months >= 6:
            overall_confidence = 'high'
        elif data_months >= 3:
            overall_confidence = 'medium'
        else:
            overall_confidence = 'low'
        
        # Detect trend
        trend = detect_trend(historical_data)
        
        # Generate explanation
        avg_spending = sum(d['spent'] for d in historical_data) / len(historical_data)
        explanation = f"ML model trained on {data_months} months of data. "
        explanation += f"Average historical spending: ₹{round(avg_spending)}. "
        explanation += f"Trend detected: {trend}. "
        
        if next_month:
            explanation += f"Next month prediction: ₹{round(next_month['predictedAmount'])} "
            explanation += f"(range: ₹{round(next_month['lowerBound'])} - ₹{round(next_month['upperBound'])}). "
        
        if is_likely_over_budget:
            explanation += f"⚠️ Warning: Current spending pace suggests you'll exceed budget by ₹{round(budget_difference)}."
        else:
            remaining_budget = monthly_budget - final_projection if monthly_budget > 0 else 0
            explanation += f"✅ On track to stay within budget with ₹{round(remaining_budget)} to spare."
        
        # Prepare response
        response = {
            'success': True,
            'predictions': predictions,
            'nextMonthPrediction': next_month,
            'currentMonthProjection': {
                'projectedTotal': round(final_projection, 2),
                'currentSpent': current_month_spent,
                'projectedRemaining': max(0, round(final_projection - current_month_spent, 2)),
                'daysRemaining': remaining_days,
                'dailyBudgetRemaining': round((monthly_budget - current_month_spent) / max(remaining_days, 1), 2) if monthly_budget > 0 else 0
            },
            'isLikelyOverBudget': is_likely_over_budget,
            'budgetDifference': round(budget_difference, 2),
            'confidence': overall_confidence,
            'trend': trend,
            'averageSpending': round(avg_spending, 2),
            'explanation': explanation,
            'modelInfo': {
                'algorithm': 'Facebook Prophet',
                'trainingMonths': data_months,
                'features': ['trend', 'yearly_seasonality']
            }
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        app.logger.error(f"Prediction error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e),
            'message': 'ML prediction failed'
        }), 500

@app.route('/test', methods=['GET'])
def test():
    """Test endpoint with sample data"""
    sample_data = {
        "historicalData": [
            {"month": "2025-11", "spent": 15000},
            {"month": "2025-10", "spent": 18000},
            {"month": "2025-09", "spent": 14500},
            {"month": "2025-08", "spent": 16000},
            {"month": "2025-07", "spent": 15500},
            {"month": "2025-06", "spent": 17000}
        ],
        "currentMonthSpent": 12000,
        "daysPassedInMonth": 15,
        "totalDaysInMonth": 30,
        "monthlyBudget": 20000,
        "forecastMonths": 3
    }
    
    # Make prediction with test data
    with app.test_request_context(json=sample_data):
        response = predict()
        return response

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False)
