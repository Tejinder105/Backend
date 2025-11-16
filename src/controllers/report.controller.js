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
import PDFDocument from 'pdfkit';

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

    // Get recent transactions for display
    const recentTransactions = await Transaction.find({
        flatId: new mongoose.Types.ObjectId(flatId),
        type: 'payment',
        createdAt: { $gte: startDate, $lt: endDate }
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('fromUserId', 'userName')
    .populate('billId', 'title category')
    .lean();

    // Format transactions for frontend
    const formattedTransactions = recentTransactions.map(txn => ({
        description: txn.note || txn.billId?.title || 'Payment',
        type: txn.billId?.category || 'payment',
        amount: txn.amount,
        date: txn.createdAt,
        paymentMethod: txn.paymentMethod
    }));

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
            totalSpent: totalPaid,
            transactionCount: payments[0]?.count || 0,
            transactions: formattedTransactions,
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

// Export report (CSV or PDF)
export const exportReport = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month, format = 'pdf' } = req.query;

    const flat = await Flat.findById(flatId).populate('admin', 'userName');
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

    // Get transactions for the month
    const transactions = await Transaction.find({
        flatId,
        type: 'payment',
        createdAt: { $gte: startDate, $lt: endDate }
    })
    .populate('fromUserId', 'userName')
    .populate('billId', 'title category')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

    // Get category breakdown
    const categoryData = await Bill.aggregate([
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
                count: { $sum: 1 }
            }
        }
    ]);

    const totalSpent = categoryData.reduce((sum, cat) => sum + cat.totalAmount, 0);
    const categorySpending = categoryData.map(cat => ({
        category: cat._id,
        totalAmount: cat.totalAmount,
        count: cat.count,
        percentage: totalSpent > 0 ? (cat.totalAmount / totalSpent) * 100 : 0
    }));

    if (format === 'csv') {
        // Generate CSV string
        const csvHeader = 'Date,Description,Type,Amount\n';
        const csvRows = transactions.map(txn => 
            `${new Date(txn.createdAt).toLocaleDateString()},${txn.note || txn.billId?.title || 'Transaction'},${txn.billId?.category || 'payment'},${txn.amount}`
        ).join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=SmartRent_Report_${targetMonth}.csv`);
        return res.send(csvHeader + csvRows);
    }

    if (format === 'pdf') {
        // Generate PDF
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        
        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=SmartRent_Report_${targetMonth}.pdf`);
        
        // Pipe PDF to response
        doc.pipe(res);

        // Title
        doc.fontSize(24).fillColor('#1f2937').text('Smart Rent - Monthly Report', { align: 'left' });
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#3b82f6').lineWidth(3).stroke();
        doc.moveDown();

        // Report Info
        doc.fontSize(12).fillColor('#6b7280');
        doc.text(`Flat: ${flat.name}`, { continued: false });
        doc.text(`Period: ${new Date(startDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, { continued: false });
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, { continued: false });
        doc.moveDown(2);

        // Summary boxes
        doc.fontSize(14).fillColor('#111827').text('Summary', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#6b7280').text(`Total Spent: ₹${totalSpent.toFixed(2)}`, { continued: false });
        doc.text(`Transactions: ${transactions.length}`, { continued: false });
        doc.moveDown(2);

        // Category Breakdown
        if (categorySpending.length > 0) {
            doc.fontSize(14).fillColor('#111827').text('Category Breakdown', { underline: true });
            doc.moveDown(0.5);

            // Table header
            doc.fontSize(10).fillColor('#374151');
            const tableTop = doc.y;
            const col1 = 50;
            const col2 = 200;
            const col3 = 350;
            const col4 = 450;

            doc.text('Category', col1, tableTop, { width: 140 });
            doc.text('Amount', col2, tableTop, { width: 140 });
            doc.text('Percentage', col3, tableTop, { width: 90 });
            doc.text('Count', col4, tableTop, { width: 90 });
            
            doc.moveTo(col1, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
            doc.moveDown(0.5);

            // Table rows
            categorySpending.forEach((cat) => {
                const rowTop = doc.y;
                doc.fontSize(9).fillColor('#111827');
                doc.text(cat.category.charAt(0).toUpperCase() + cat.category.slice(1), col1, rowTop, { width: 140 });
                doc.text(`₹${cat.totalAmount.toFixed(2)}`, col2, rowTop, { width: 140 });
                doc.text(`${cat.percentage.toFixed(1)}%`, col3, rowTop, { width: 90 });
                doc.text(cat.count.toString(), col4, rowTop, { width: 90 });
                doc.moveDown(0.7);
            });

            doc.moveDown(1);
        }

        // Recent Transactions
        if (transactions.length > 0) {
            doc.fontSize(14).fillColor('#111827').text('Recent Transactions', { underline: true });
            doc.moveDown(0.5);

            // Table header
            doc.fontSize(10).fillColor('#374151');
            const tableTop = doc.y;
            const col1 = 50;
            const col2 = 130;
            const col3 = 310;
            const col4 = 470;

            doc.text('Date', col1, tableTop, { width: 70 });
            doc.text('Description', col2, tableTop, { width: 170 });
            doc.text('Type', col3, tableTop, { width: 150 });
            doc.text('Amount', col4, tableTop, { width: 80 });
            
            doc.moveTo(col1, doc.y).lineTo(550, doc.y).strokeColor('#e5e7eb').lineWidth(1).stroke();
            doc.moveDown(0.5);

            // Table rows
            transactions.forEach((txn) => {
                const rowTop = doc.y;
                doc.fontSize(9).fillColor('#111827');
                doc.text(new Date(txn.createdAt).toLocaleDateString(), col1, rowTop, { width: 70 });
                doc.text(txn.note || txn.billId?.title || 'Transaction', col2, rowTop, { width: 170 });
                doc.text((txn.billId?.category || 'payment').charAt(0).toUpperCase() + (txn.billId?.category || 'payment').slice(1), col3, rowTop, { width: 150 });
                doc.text(`₹${txn.amount.toFixed(2)}`, col4, rowTop, { width: 80 });
                doc.moveDown(0.7);

                // Add new page if needed
                if (doc.y > 700) {
                    doc.addPage();
                }
            });
        }

        // Footer
        doc.moveDown(3);
        doc.fontSize(9).fillColor('#6b7280').text('This report was generated by Smart Rent', { align: 'center' });
        doc.text(`© ${new Date().getFullYear()} Smart Rent. All rights reserved.`, { align: 'center' });

        // Finalize PDF
        doc.end();
        return;
    }

    return res.status(200).json(
        new ApiResponse(200, { transactions, categorySpending, month: targetMonth }, "Report exported successfully")
    );
});
