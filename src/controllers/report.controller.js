import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Flat } from "../models/flat.model.js";
import { Bill } from "../models/bill.model.js";
import { BillSplit } from "../models/billSplit.model.js";
import { Transaction } from "../models/transaction.model.js";
import { BudgetSnapshot } from "../models/budgetSnapshot.model.js";
import mongoose from "mongoose";

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

// Budget forecast using simple moving average
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

    // Get last 6 months of spending data
    const historicalMonths = [];
    const currentDate = new Date();
    
    for (let i = 0; i < 6; i++) {
        const date = new Date(currentDate);
        date.setMonth(date.getMonth() - i);
        historicalMonths.push(date.toISOString().slice(0, 7));
    }

    const snapshots = await BudgetSnapshot.find({
        flatId,
        month: { $in: historicalMonths }
    }).sort({ month: -1 });

    // Calculate spending data
    const historicalData = [];
    
    for (const month of historicalMonths) {
        let snapshot = snapshots.find(s => s.month === month);
        
        if (!snapshot) {
            // Calculate actual spending for this month
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

            historicalData.push({
                month,
                spent: bills[0]?.total || 0
            });
        } else {
            historicalData.push({
                month: snapshot.month,
                spent: snapshot.actualSpent
            });
        }
    }

    // Calculate moving average
    const recentData = historicalData.slice(0, Math.min(3, historicalData.length));
    const avgSpending = recentData.reduce((sum, data) => sum + data.spent, 0) / recentData.length;

    // Calculate trend
    let trend = 'stable';
    if (recentData.length >= 2) {
        const recent = recentData[0].spent;
        const older = recentData[recentData.length - 1].spent;
        const percentChange = ((recent - older) / older) * 100;
        
        if (percentChange > 10) trend = 'increasing';
        else if (percentChange < -10) trend = 'decreasing';
    }

    // Generate forecasts
    const forecasts = [];
    for (let i = 1; i <= parseInt(months); i++) {
        const forecastDate = new Date(currentDate);
        forecastDate.setMonth(forecastDate.getMonth() + i);
        const forecastMonth = forecastDate.toISOString().slice(0, 7);

        // Simple forecast with trend adjustment
        let predictedAmount = avgSpending;
        if (trend === 'increasing') {
            predictedAmount *= (1 + (0.05 * i)); // 5% increase per month
        } else if (trend === 'decreasing') {
            predictedAmount *= (1 - (0.05 * i)); // 5% decrease per month
        }

        forecasts.push({
            month: forecastMonth,
            predictedAmount: Math.round(predictedAmount),
            confidence: recentData.length >= 3 ? 'medium' : 'low'
        });
    }

    const explanation = `Based on the last ${recentData.length} months of data, your average monthly spending is ${Math.round(avgSpending)}. The trend is ${trend}. ${
        trend === 'increasing' 
            ? 'Spending has been increasing, so budget accordingly.' 
            : trend === 'decreasing'
            ? 'Spending has been decreasing, which is good!'
            : 'Spending has been relatively stable.'
    }`;

    return res.status(200).json(
        new ApiResponse(200, {
            currentBudget: flat.monthlyBudget,
            historicalData: recentData,
            averageSpending: Math.round(avgSpending),
            trend,
            forecasts,
            explanation
        }, "Budget forecast generated successfully")
    );
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
