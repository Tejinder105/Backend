import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { BudgetSnapshot } from "../models/budgetSnapshot.model.js";
import { Flat } from "../models/flat.model.js";
import { Transaction } from "../models/transaction.model.js";
import { Bill } from "../models/bill.model.js";
import { Expense } from "../models/expense.model.js";
import axios from "axios";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

/**
 * Get current month's budget snapshot for a flat
 * @route GET /api/v2/flats/:flatId/budget/current
 */
export const getCurrentBudget = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const userId = req.user._id;

    // Verify user has access to flat
    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Get current month date range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const currentMonth = now.toISOString().slice(0, 7);
    
    console.log('💰 [getCurrentBudget] Calculating real-time spending for:', {
        flatId,
        month: currentMonth,
        dateRange: { start: startOfMonth, end: endOfMonth }
    });

    // Calculate REAL-TIME spending from bills and expenses
    // Query bills that are paid or partially paid
    const bills = await Bill.find({
        flatId,
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        status: { $in: ['paid', 'partial'] }
    }).select('totalAmount status category');

    // Query expenses that are settled or active
    const expenses = await Expense.find({
        flatId,
        createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        status: { $in: ['settled', 'active'] }
    }).select('totalAmount status category');

    // Calculate total spending
    const billsTotal = bills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);
    const expensesTotal = expenses.reduce((sum, expense) => sum + (expense.totalAmount || 0), 0);
    const actualSpent = billsTotal + expensesTotal;

    console.log('💰 [getCurrentBudget] Real-time calculation:', {
        billsCount: bills.length,
        billsTotal,
        expensesCount: expenses.length,
        expensesTotal,
        totalSpent: actualSpent
    });
    
    // Find or create budget snapshot (for historical tracking)
    let snapshot = await BudgetSnapshot.findOne({ 
        flatId, 
        month: currentMonth 
    });

    if (!snapshot) {
        // Create new snapshot
        snapshot = new BudgetSnapshot({
            flatId,
            month: currentMonth,
            budgetAmount: flat.monthlyBudget || 0,
            predictedAmount: flat.monthlyBudget || 0,
            actualSpent: actualSpent
        });
    } else {
        // Update snapshot with real-time data
        snapshot.budgetAmount = flat.monthlyBudget || 0;
        snapshot.actualSpent = actualSpent;
        snapshot.predictedAmount = flat.monthlyBudget || 0;
    }
    
    await snapshot.save();

    // Calculate breakdown by category (real-time)
    const breakdown = {};
    
    // Add bill categories
    for (const bill of bills) {
        const category = bill.category || 'other';
        breakdown[category] = (breakdown[category] || 0) + bill.totalAmount;
    }
    
    // Add expense categories
    for (const expense of expenses) {
        const category = expense.category || 'other';
        breakdown[category] = (breakdown[category] || 0) + expense.totalAmount;
    }

    // Prepare response with enhanced budget data
    const budgetData = {
        _id: snapshot._id,
        flatId: snapshot.flatId,
        month: snapshot.month,
        budgetAmount: snapshot.budgetAmount,
        actualSpent: actualSpent, // Real-time value
        predictedAmount: snapshot.predictedAmount,
        monthlyBudget: flat.monthlyBudget || 0,
        currentSpending: actualSpent, // Real-time value for UI
        breakdown: breakdown, // Real-time category breakdown
        createdAt: snapshot.createdAt,
        updatedAt: new Date() // Mark as just updated
    };

    console.log('✅ [getCurrentBudget] Response:', {
        monthlyBudget: budgetData.monthlyBudget,
        currentSpending: budgetData.currentSpending,
        breakdown: Object.keys(budgetData.breakdown).length
    });

    return res.status(200).json(
        new ApiResponse(200, budgetData, "Current budget fetched successfully")
    );
});

/**
 * Get budget history for a flat
 * @route GET /api/v2/flats/:flatId/budget/history
 */
export const getBudgetHistory = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { limit = 12 } = req.query;
    const userId = req.user._id;

    // Verify user has access to flat
    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Get last N months of budget snapshots
    const snapshots = await BudgetSnapshot.find({ flatId })
        .sort({ month: -1 })
        .limit(parseInt(limit));

    return res.status(200).json(
        new ApiResponse(200, snapshots, "Budget history fetched successfully")
    );
});

/**
 * Get ML-based budget forecast for a flat
 * @route GET /api/v2/flats/:flatId/budget/forecast
 * Predicts only next month spending and tracks current month
 */
export const getBudgetForecast = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const userId = req.user._id;

    // Verify user has access to flat
    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Get historical budget data (last 12 months)
    const snapshots = await BudgetSnapshot.find({ flatId })
        .sort({ month: -1 })
        .limit(12);

    if (snapshots.length < 2) {
        throw new ApiError(400, "Insufficient historical data. Need at least 2 months of data for forecasting.");
    }

    // Prepare historical data for ML model
    const historicalData = snapshots.reverse().map(snapshot => ({
        month: snapshot.month,
        spent: snapshot.actualSpent
    }));

    // Get current month data with real-time calculation
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const daysInMonth = endOfMonth.getDate();
    const daysPassed = now.getDate();

    // Calculate current month spending from bills and expenses (real-time)
    const bills = await Bill.find({
        flatId,
        createdAt: { $gte: startOfMonth, $lte: now },
        status: { $in: ['paid', 'partial'] }
    }).select('totalAmount');

    const expenses = await Expense.find({
        flatId,
        createdAt: { $gte: startOfMonth, $lte: now },
        status: { $in: ['settled', 'active'] }
    }).select('totalAmount');

    const billsTotal = bills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);
    const expensesTotal = expenses.reduce((sum, expense) => sum + (expense.totalAmount || 0), 0);
    const currentMonthSpent = billsTotal + expensesTotal;

    // Prepare request to ML service (only predict next month)
    const mlRequest = {
        historicalData: historicalData,
        currentMonthSpent: currentMonthSpent,
        daysPassedInMonth: daysPassed,
        totalDaysInMonth: daysInMonth,
        monthlyBudget: flat.monthlyBudget || 0,
        forecastMonths: 1  // Only predict next month
    };

    console.log('🤖 [ML Forecast] Request:', {
        flatId,
        historicalMonths: historicalData.length,
        currentSpent: currentMonthSpent,
        budget: flat.monthlyBudget,
        forecastMonths: 1
    });

    try {
        // Call ML service
        const mlResponse = await axios.post(`${ML_SERVICE_URL}/predict`, mlRequest, {
            timeout: 30000 // 30 second timeout
        });

        const forecast = mlResponse.data;

        console.log('🤖 [ML Forecast] Success:', {
            nextMonth: forecast.nextMonthPrediction,
            currentMonthProjection: forecast.currentMonthProjection,
            confidence: forecast.confidence,
            trend: forecast.trend
        });

        return res.status(200).json(
            new ApiResponse(200, forecast, "Budget forecast generated successfully")
        );

    } catch (error) {
        console.error('❌ [ML Forecast] Error:', error.message);
        
        // Check if ML service is running
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            throw new ApiError(503, "ML forecasting service is not available. Please ensure the ML service is running.");
        }

        // Other ML service errors
        if (error.response) {
            const mlError = error.response.data;
            throw new ApiError(500, mlError.message || "ML prediction failed", mlError.error);
        }

        throw new ApiError(500, "Failed to generate budget forecast");
    }
});

export default {
    getCurrentBudget,
    getBudgetHistory,
    getBudgetForecast
};
