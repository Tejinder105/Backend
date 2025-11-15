import axios from 'axios';

/**
 * ML Service Configuration
 */
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const ML_TIMEOUT = 30000; // 30 seconds for ML processing

/**
 * ML Budget Forecasting Service
 * Connects to Python ML microservice running Prophet model
 */
class MLForecastService {
    constructor() {
        this.client = axios.create({
            baseURL: ML_SERVICE_URL,
            timeout: ML_TIMEOUT,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Check if ML service is healthy
     * @returns {Promise<boolean>}
     */
    async isHealthy() {
        try {
            const response = await this.client.get('/health', { timeout: 5000 });
            return response.status === 200;
        } catch (error) {
            console.error('ML service health check failed:', error.message);
            return false;
        }
    }

    /**
     * Get ML-based budget forecast
     * @param {Object} data - Historical and current spending data
     * @returns {Promise<Object>} - ML predictions
     */
    async predictBudget(data) {
        try {
            const response = await this.client.post('/predict', data);
            return {
                success: true,
                ...response.data
            };
        } catch (error) {
            console.error('ML prediction failed:', error.message);
            
            if (error.response) {
                // ML service returned an error
                return {
                    success: false,
                    error: error.response.data.error || 'ML prediction failed',
                    message: error.response.data.message
                };
            } else if (error.code === 'ECONNREFUSED') {
                // ML service not running
                return {
                    success: false,
                    error: 'ML service unavailable',
                    message: 'ML forecasting service is not running. Using fallback prediction.'
                };
            } else {
                // Network or timeout error
                return {
                    success: false,
                    error: 'ML service error',
                    message: error.message
                };
            }
        }
    }

    /**
     * Fallback prediction using simple moving average
     * Used when ML service is unavailable
     */
    fallbackPredict(historicalData, currentMonthSpent, daysPassedInMonth, totalDaysInMonth, monthlyBudget, forecastMonths = 3) {
        try {
            // Calculate average from recent months
            const recentData = historicalData.slice(0, Math.min(3, historicalData.length));
            const avgSpending = recentData.reduce((sum, d) => sum + d.spent, 0) / recentData.length;

            // Detect trend
            let trend = 'stable';
            if (recentData.length >= 2) {
                const recent = recentData[0].spent;
                const older = recentData[recentData.length - 1].spent;
                const percentChange = ((recent - older) / older) * 100;
                
                if (percentChange > 10) trend = 'increasing';
                else if (percentChange < -10) trend = 'decreasing';
            }

            // Generate simple forecasts
            const predictions = [];
            const currentDate = new Date();
            
            for (let i = 1; i <= forecastMonths; i++) {
                const forecastDate = new Date(currentDate);
                forecastDate.setMonth(forecastDate.getMonth() + i);
                const forecastMonth = forecastDate.toISOString().slice(0, 7);

                let predictedAmount = avgSpending;
                if (trend === 'increasing') {
                    predictedAmount *= (1 + (0.05 * i));
                } else if (trend === 'decreasing') {
                    predictedAmount *= (1 - (0.05 * i));
                }

                predictions.push({
                    month: forecastMonth,
                    predictedAmount: Math.round(predictedAmount),
                    lowerBound: Math.round(predictedAmount * 0.8),
                    upperBound: Math.round(predictedAmount * 1.2),
                    confidence: recentData.length >= 3 ? 'medium' : 'low'
                });
            }

            // Current month projection
            const dailyRate = currentMonthSpent / Math.max(daysPassedInMonth, 1);
            const projectedTotal = dailyRate * totalDaysInMonth;
            const remainingDays = totalDaysInMonth - daysPassedInMonth;

            // Over-budget detection
            const isLikelyOverBudget = projectedTotal > monthlyBudget;
            const budgetDifference = projectedTotal - monthlyBudget;

            return {
                success: true,
                usedFallback: true,
                predictions,
                nextMonthPrediction: predictions[0] || null,
                currentMonthProjection: {
                    projectedTotal: Math.round(projectedTotal),
                    currentSpent: currentMonthSpent,
                    projectedRemaining: Math.max(0, Math.round(projectedTotal - currentMonthSpent)),
                    daysRemaining: remainingDays,
                    dailyBudgetRemaining: Math.round((monthlyBudget - currentMonthSpent) / Math.max(remainingDays, 1))
                },
                isLikelyOverBudget,
                budgetDifference: Math.round(budgetDifference),
                confidence: recentData.length >= 3 ? 'medium' : 'low',
                trend,
                averageSpending: Math.round(avgSpending),
                explanation: `Fallback prediction: Based on ${recentData.length} months, average spending is ₹${Math.round(avgSpending)}. Trend: ${trend}. ${isLikelyOverBudget ? '⚠️ May exceed budget.' : '✅ On track.'}`,
                modelInfo: {
                    algorithm: 'Simple Moving Average (Fallback)',
                    trainingMonths: recentData.length,
                    features: ['trend']
                }
            };
        } catch (error) {
            console.error('Fallback prediction failed:', error.message);
            throw error;
        }
    }

    /**
     * Get ML forecast with automatic fallback
     * @param {Object} params - Forecast parameters
     * @returns {Promise<Object>} - Prediction results
     */
    async getForecast(params) {
        const {
            historicalData,
            currentMonthSpent = 0,
            daysPassedInMonth = 1,
            totalDaysInMonth = 30,
            monthlyBudget = 0,
            forecastMonths = 3
        } = params;

        // Validate input
        if (!historicalData || historicalData.length < 2) {
            throw new Error('Need at least 2 months of historical data for forecasting');
        }

        // Try ML prediction first
        const mlResult = await this.predictBudget({
            historicalData,
            currentMonthSpent,
            daysPassedInMonth,
            totalDaysInMonth,
            monthlyBudget,
            forecastMonths
        });

        // If ML succeeded, return results
        if (mlResult.success && !mlResult.error) {
            return {
                ...mlResult,
                usedML: true,
                usedFallback: false
            };
        }

        // ML failed, use fallback
        console.warn('ML prediction unavailable, using fallback method');
        return this.fallbackPredict(
            historicalData,
            currentMonthSpent,
            daysPassedInMonth,
            totalDaysInMonth,
            monthlyBudget,
            forecastMonths
        );
    }
}

// Export singleton instance
export default new MLForecastService();
