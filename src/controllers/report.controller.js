import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Flat } from "../models/flat.model.js";
import { Bill } from "../models/bill.model.js";
import { BillSplit } from "../models/billSplit.model.js";
import { Transaction } from "../models/transaction.model.js";
import { BudgetSnapshot } from "../models/budgetSnapshot.model.js";
import mongoose from "mongoose";
import mlService from "../services/ml.service.js";

// Get monthly report
export const getMonthlyReport = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month } = req.query; // Format: YYYY-MM

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Parse month or use current
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const startDate = new Date(targetMonth + '-01');
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    // Get bills for the month
    const bills = await Bill.aggregate([
        {
            $match: {
                flatId: new mongoose.Types.ObjectId(flatId),
                dueDate: { $gte: startDate, $lt: endDate }
            }
        },
        {
            $group: {
                _id: '$category',
                totalAmount: { $sum: '$totalAmount' },
                count: { $sum: 1 },
                paidCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] }
                },
                pendingCount: {
                    $sum: { $cond: [{ $ne: ['$status', 'paid'] }, 1, 0] }
                }
            }
        }
    ]);

    // Get payment summary
    const payments = await Transaction.aggregate([
        {
            $match: {
                flatId: new mongoose.Types.ObjectId(flatId),
                type: 'payment',
                createdAt: { $gte: startDate, $lt: endDate }
            }
        },
        {
            $group: {
                _id: null,
                totalPaid: { $sum: '$amount' },
                count: { $sum: 1 }
            }
        }
    ]);

    // Get budget snapshot
    let snapshot = await BudgetSnapshot.findOne({ flatId, month: targetMonth });
    if (!snapshot && flat.monthlyBudget > 0) {
        snapshot = await BudgetSnapshot.getOrCreate(flatId, targetMonth, flat.monthlyBudget);
        await snapshot.updateActualSpent();
    }

    const totalBills = bills.reduce((sum, cat) => sum + cat.totalAmount, 0);
    const totalPaid = payments[0]?.totalPaid || 0;

    return res.status(200).json(
        new ApiResponse(200, {
            month: targetMonth,
            summary: {
                totalBills,
                totalPaid,
                pending: totalBills - totalPaid,
                budget: flat.monthlyBudget,
                budgetUsed: snapshot ? snapshot.actualSpent : 0,
                budgetRemaining: flat.monthlyBudget - (snapshot ? snapshot.actualSpent : 0)
            },
            categoryBreakdown: bills,
            paymentStats: payments[0] || { totalPaid: 0, count: 0 },
            budgetSnapshot: snapshot
        }, "Monthly report fetched successfully")
    );
});

// Set flat budget
export const setFlatBudget = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { monthlyBudget } = req.body;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id)) {
        throw new ApiError(403, "Only flat admin can set budget");
    }

    flat.monthlyBudget = monthlyBudget;
    await flat.save();

    // Create/update budget snapshot for current month
    const currentMonth = new Date().toISOString().slice(0, 7);
    let snapshot = await BudgetSnapshot.findOne({ flatId, month: currentMonth });
    
    if (!snapshot) {
        snapshot = await BudgetSnapshot.getOrCreate(flatId, currentMonth, monthlyBudget);
    } else {
        snapshot.budgetAmount = monthlyBudget;
        await snapshot.save();
    }

    await snapshot.updateActualSpent();

    return res.status(200).json(
        new ApiResponse(200, { flat, snapshot }, "Budget set successfully")
    );
});

// ML-powered budget forecast using Facebook Prophet
export const forecastBudget = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { months = 3 } = req.query;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Get historical spending data (up to 24 months for better ML accuracy)
    const historicalMonths = [];
    const currentDate = new Date();
    
    for (let i = 1; i <= 24; i++) {  // Start from 1 to exclude current month
        const date = new Date(currentDate);
        date.setMonth(date.getMonth() - i);
        historicalMonths.push(date.toISOString().slice(0, 7));
    }

    const snapshots = await BudgetSnapshot.find({
        flatId,
        month: { $in: historicalMonths }
    }).sort({ month: -1 });

    // Calculate spending data for each historical month
    const historicalData = [];
    
    for (const month of historicalMonths) {
        let snapshot = snapshots.find(s => s.month === month);
        
        if (!snapshot) {
            // Calculate actual spending for this month from bills
            const startDate = new Date(month + '-01');
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 1);

            const bills = await Bill.aggregate([
                {
                    $match: {
                        flatId: new mongoose.Types.ObjectId(flatId),
                        dueDate: { $gte: startDate, $lt: endDate },
                        status: { $in: ['paid', 'partial'] }
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$totalAmount' }
                    }
                }
            ]);

            const spent = bills[0]?.total || 0;
            if (spent > 0) {  // Only include months with spending data
                historicalData.push({ month, spent });
            }
        } else {
            historicalData.push({
                month: snapshot.month,
                spent: snapshot.actualSpent
            });
        }
    }

    // Need at least 2 months for ML prediction
    if (historicalData.length < 2) {
        throw new ApiError(400, "Insufficient historical data. Need at least 2 months of spending history.");
    }

    // Get current month spending for over-budget detection
    const currentMonthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const currentMonthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    
    const currentMonthBills = await Bill.aggregate([
        {
            $match: {
                flatId: new mongoose.Types.ObjectId(flatId),
                dueDate: { $gte: currentMonthStart, $lte: currentMonthEnd },
                status: { $in: ['paid', 'partial'] }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$totalAmount' }
            }
        }
    ]);

    const currentMonthSpent = currentMonthBills[0]?.total || 0;
    const daysPassedInMonth = currentDate.getDate();
    const totalDaysInMonth = currentMonthEnd.getDate();

    try {
        // Call ML service for prediction
        const mlForecast = await mlService.getForecast({
            historicalData,
            currentMonthSpent,
            daysPassedInMonth,
            totalDaysInMonth,
            monthlyBudget: flat.monthlyBudget || 0,
            forecastMonths: parseInt(months)
        });

        // Prepare response
        return res.status(200).json(
            new ApiResponse(200, {
                currentBudget: flat.monthlyBudget,
                currentMonthSpent,
                currentMonthProjection: mlForecast.currentMonthProjection,
                isLikelyOverBudget: mlForecast.isLikelyOverBudget,
                budgetDifference: mlForecast.budgetDifference,
                historicalData: historicalData.slice(0, 6), // Show last 6 months
                predictions: mlForecast.predictions,
                nextMonthPrediction: mlForecast.nextMonthPrediction,
                averageSpending: mlForecast.averageSpending,
                trend: mlForecast.trend,
                confidence: mlForecast.confidence,
                explanation: mlForecast.explanation,
                modelInfo: mlForecast.modelInfo,
                usedML: mlForecast.usedML !== false,
                usedFallback: mlForecast.usedFallback || false
            }, mlForecast.usedML ? "ML budget forecast generated successfully" : "Budget forecast generated (fallback mode)")
        );
    } catch (error) {
        console.error('Forecast error:', error.message);
        throw new ApiError(500, `Failed to generate forecast: ${error.message}`);
    }
});

// Get category-wise spending
export const getCategorySpending = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { startDate, endDate } = req.query;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    const matchStage = { flatId: new mongoose.Types.ObjectId(flatId) };
    
    if (startDate || endDate) {
        matchStage.dueDate = {};
        if (startDate) matchStage.dueDate.$gte = new Date(startDate);
        if (endDate) matchStage.dueDate.$lte = new Date(endDate);
    }

    const categoryData = await Bill.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: '$category',
                totalAmount: { $sum: '$totalAmount' },
                count: { $sum: 1 },
                avgAmount: { $avg: '$totalAmount' }
            }
        },
        { $sort: { totalAmount: -1 } }
    ]);

    const totalSpending = categoryData.reduce((sum, cat) => sum + cat.totalAmount, 0);

    const categoryBreakdown = categoryData.map(cat => ({
        category: cat._id,
        totalAmount: cat.totalAmount,
        count: cat.count,
        avgAmount: Math.round(cat.avgAmount),
        percentage: ((cat.totalAmount / totalSpending) * 100).toFixed(1)
    }));

    return res.status(200).json(
        new ApiResponse(200, {
            totalSpending,
            categoryBreakdown
        }, "Category spending fetched successfully")
    );
});

// Export report (basic CSV data)
export const exportReport = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month, format = 'json' } = req.query;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const startDate = new Date(targetMonth + '-01');
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const bills = await Bill.find({
        flatId,
        dueDate: { $gte: startDate, $lt: endDate }
    })
    .populate('createdBy', 'userName')
    .lean();

    if (format === 'csv') {
        // Generate CSV string
        const csvHeader = 'Date,Title,Category,Amount,Status,Created By\n';
        const csvRows = bills.map(bill => 
            `${new Date(bill.dueDate).toLocaleDateString()},${bill.title},${bill.category},${bill.totalAmount},${bill.status},${bill.createdBy?.userName || 'Unknown'}`
        ).join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=report-${targetMonth}.csv`);
        return res.send(csvHeader + csvRows);
    }

    return res.status(200).json(
        new ApiResponse(200, { bills, month: targetMonth }, "Report exported successfully")
    );
});
