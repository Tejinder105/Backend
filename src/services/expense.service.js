/**
 * Unified Expense Service
 * Handles all expense-related business logic for both bills and split expenses
 */

import mongoose from "mongoose";
import { Bill } from "../models/bill.model.js";
import { BillSplit } from "../models/billSplit.model.js";
import { Expense } from "../models/expense.model.js";
import { Transaction } from "../models/transaction.model.js";
import { BudgetSnapshot } from "../models/budgetSnapshot.model.js";
import { Flat } from "../models/flat.model.js";
import { notifyBillCreated, notifyExpenseCreated, notifyPaymentReceived } from "./notification.service.js";

class ExpenseService {
    /**
     * Create a new expense (unified for both bills and split expenses)
     * @param {Object} data - Expense data
     * @param {ObjectId} userId - Creator user ID
     * @returns {Promise<Object>} Created expense with all relations
     */
    async createExpense(data, userId) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const {
                flatId,
                type = 'shared', // 'shared' (bill) or 'split' (expense)
                title,
                description,
                vendor,
                totalAmount,
                dueDate,
                category,
                splitMethod = 'equal',
                participants,
                notes,
                isRecurring,
                recurrenceRule,
                imageUrl
            } = data;

            // Validate flat exists and user has access
            const flat = await Flat.findById(flatId).session(session);
            if (!flat) {
                throw new Error("Flat not found");
            }

            if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
                throw new Error("You don't have access to this flat");
            }

            let expense;
            let billSplits = [];

            if (type === 'shared') {
                // Create as Bill with BillSplits
                const bill = await Bill.create([{
                    flatId,
                    title,
                    vendor,
                    totalAmount,
                    dueDate,
                    createdBy: userId,
                    category: category || 'other',
                    notes,
                    isRecurring: isRecurring || false,
                    recurrenceRule: isRecurring ? recurrenceRule : undefined,
                    imageUrl
                }], { session });

                // Create splits
                const amountPerPerson = totalAmount / participants.length;
                
                for (const participant of participants) {
                    const split = await BillSplit.create([{
                        billId: bill[0]._id,
                        userId: participant.userId,
                        amount: splitMethod === 'equal' 
                            ? Math.round(amountPerPerson * 100) / 100
                            : participant.amount,
                        status: 'owed'
                    }], { session });
                    
                    billSplits.push(split[0]);
                }

                // Update bill status
                await bill[0].updateStatus();
                await bill[0].save({ session });

                expense = bill[0];

                // Send notifications
                try {
                    const participantIds = participants.map(p => p.userId);
                    await notifyBillCreated(expense, participantIds);
                } catch (notifError) {
                    console.error('Failed to send notifications:', notifError);
                }

            } else {
                // Create as Expense
                const validParticipants = [];
                let calculatedTotal = 0;

                for (const participant of participants) {
                    let amount;
                    if (splitMethod === 'equal') {
                        amount = totalAmount / participants.length;
                    } else {
                        amount = participant.amount;
                    }

                    validParticipants.push({
                        userId: participant.userId,
                        name: participant.name,
                        amount: Math.round(amount * 100) / 100,
                        isPaid: false
                    });

                    calculatedTotal += amount;
                }

                if (splitMethod === 'custom' && Math.abs(calculatedTotal - totalAmount) > 0.01) {
                    throw new Error("Custom amounts must sum up to total amount");
                }

                expense = await Expense.create([{
                    flatId, // ADDED: Now expenses are linked to flats
                    createdBy: userId,
                    title,
                    description: description || title,
                    totalAmount,
                    category: category || 'other',
                    splitMethod,
                    participants: validParticipants,
                    notes
                }], { session });

                expense = expense[0];

                // Send notifications
                try {
                    await notifyExpenseCreated(expense, userId);
                } catch (notifError) {
                    console.error('Failed to send notifications:', notifError);
                }
            }

            // Update budget snapshot for current month
            const currentMonth = new Date().toISOString().slice(0, 7);
            await this._updateBudgetSnapshot(flatId, currentMonth, session);

            await session.commitTransaction();

            // Populate and return
            const populatedExpense = await this._populateExpense(expense, type);
            
            return {
                type,
                expense: populatedExpense,
                splits: billSplits.length > 0 ? billSplits : undefined
            };

        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Get complete financial summary for a flat
     * Single optimized query returning all financial data
     * @param {ObjectId} flatId - Flat ID
     * @param {String} month - Month in YYYY-MM format (optional)
     * @param {ObjectId} userId - Requesting user ID
     * @returns {Promise<Object>} Complete financial data
     */
    async getFinancialSummary(flatId, month, userId) {
        // Verify access
        const flat = await Flat.findById(flatId);
        if (!flat) {
            throw new Error("Flat not found");
        }

        if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
            throw new Error("You don't have access to this flat");
        }

        // Format month properly - accept YYYY-MM or build from year/month params
        let targetMonth;
        if (month && month.includes('-')) {
            // Already in YYYY-MM format
            targetMonth = month;
        } else if (month) {
            // Assume it's just month number, use current year
            const year = new Date().getFullYear();
            targetMonth = `${year}-${String(month).padStart(2, '0')}`;
        } else {
            // Use current month
            targetMonth = new Date().toISOString().slice(0, 7);
        }

        const startDate = new Date(targetMonth + '-01');
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);

        // Single aggregation query for all bills
        const billsSummary = await Bill.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    dueDate: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $facet: {
                    byCategory: [
                        {
                            $group: {
                                _id: '$category',
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 },
                                paidCount: {
                                    $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] }
                                }
                            }
                        }
                    ],
                    byStatus: [
                        {
                            $group: {
                                _id: '$status',
                                count: { $sum: 1 },
                                totalAmount: { $sum: '$totalAmount' }
                            }
                        }
                    ],
                    total: [
                        {
                            $group: {
                                _id: null,
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    recent: [
                        { $sort: { dueDate: -1 } },
                        { $limit: 10 },
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'createdBy',
                                foreignField: '_id',
                                as: 'creator'
                            }
                        },
                        { $unwind: '$creator' }
                    ]
                }
            }
        ]);

        // Single aggregation for expenses
        const expensesSummary = await Expense.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    createdAt: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $facet: {
                    byCategory: [
                        {
                            $group: {
                                _id: '$category',
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    total: [
                        {
                            $group: {
                                _id: null,
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]);

        // Single query for transactions
        const transactionsSummary = await Transaction.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    createdAt: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $group: {
                    _id: '$type',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get or create budget snapshot (cached)
        let snapshot = await BudgetSnapshot.findOne({ flatId, month: targetMonth });
        if (!snapshot && flat.monthlyBudget > 0) {
            snapshot = await BudgetSnapshot.getOrCreate(flatId, targetMonth, flat.monthlyBudget);
        }

        // Calculate spending from already fetched data
        const billsTotal = billsSummary[0]?.total[0]?.totalAmount || 0;
        const expensesTotal = expensesSummary[0]?.total[0]?.totalAmount || 0;
        const actualSpent = billsTotal + expensesTotal;

        // Update snapshot if needed (without re-querying)
        if (snapshot && Math.abs(snapshot.actualSpent - actualSpent) > 0.01) {
            snapshot.actualSpent = actualSpent;
            
            // Merge category breakdowns
            const categoryMap = {};
            billsSummary[0]?.byCategory.forEach(cat => {
                categoryMap[cat._id] = (categoryMap[cat._id] || 0) + cat.totalAmount;
            });
            expensesSummary[0]?.byCategory.forEach(cat => {
                categoryMap[cat._id] = (categoryMap[cat._id] || 0) + cat.totalAmount;
            });
            
            snapshot.categoryBreakdown = categoryMap;
            await snapshot.save();
        }

        // Get user's pending dues
        const userDues = await BillSplit.find({
            userId: userId,
            status: 'owed'
        })
        .populate({
            path: 'billId',
            match: { flatId: flatId },
            populate: { path: 'flatId', select: 'name' }
        })
        .lean();

        const filteredDues = userDues.filter(due => due.billId !== null);
        const totalDue = filteredDues.reduce((sum, due) => sum + due.amount, 0);

        // Calculate totals from transaction summary
        const paymentTotal = transactionsSummary
            .find(t => t._id === 'payment')?.totalAmount || 0;

        return {
            month: targetMonth,
            summary: {
                totalBills: billsTotal,
                totalExpenses: expensesTotal,
                totalSpent: actualSpent,
                totalPaid: paymentTotal,
                pending: actualSpent - paymentTotal,
                budget: flat.monthlyBudget,
                budgetUsed: actualSpent,
                budgetRemaining: flat.monthlyBudget - actualSpent,
                percentageUsed: flat.monthlyBudget > 0 
                    ? ((actualSpent / flat.monthlyBudget) * 100).toFixed(1)
                    : 0
            },
            bills: {
                byCategory: billsSummary[0]?.byCategory || [],
                byStatus: billsSummary[0]?.byStatus || [],
                recent: billsSummary[0]?.recent || [],
                total: billsSummary[0]?.total[0] || { totalAmount: 0, count: 0 }
            },
            expenses: {
                byCategory: expensesSummary[0]?.byCategory || [],
                total: expensesSummary[0]?.total[0] || { totalAmount: 0, count: 0 }
            },
            transactions: transactionsSummary,
            budgetSnapshot: snapshot,
            userDues: {
                dues: filteredDues,
                totalDue
            }
        };
    }

    /**
     * Get user's pending dues for a flat
     * @param {ObjectId} userId - User ID
     * @param {ObjectId} flatId - Flat ID
     * @returns {Promise<Object>} User's pending dues
     */
    async getUserDues(userId, flatId) {
        // Verify access
        const flat = await Flat.findById(flatId);
        if (!flat) {
            throw new Error("Flat not found");
        }

        if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
            throw new Error("You don't have access to this flat");
        }

        // Get user's pending bill splits
        const billDues = await BillSplit.find({
            userId: userId,
            status: 'owed'
        })
        .populate({
            path: 'billId',
            match: { flatId: flatId },
            populate: [
                { path: 'flatId', select: 'name' },
                { path: 'createdBy', select: 'userName email' }
            ]
        })
        .lean();

        // Filter out any dues where billId is null (bill not in this flat)
        const filteredBillDues = billDues.filter(due => due.billId !== null);

        // Get user's pending expense participations
        const expenseDues = await Expense.find({
            flatId: flatId,
            'participants.userId': userId,
            'participants.isPaid': false
        })
        .populate('createdBy', 'userName email')
        .populate('flatId', 'name')
        .lean();

        // Extract only the user's participation from each expense
        const filteredExpenseDues = expenseDues
            .map(expense => {
                const userParticipation = expense.participants.find(
                    p => p.userId.toString() === userId.toString() && !p.isPaid
                );
                
                // If user has already paid, skip this expense
                if (!userParticipation) {
                    return null;
                }
                
                return {
                    _id: expense._id,
                    expenseId: expense._id,
                    title: expense.title,
                    description: expense.description,
                    category: expense.category,
                    amount: userParticipation.amount,
                    createdBy: expense.createdBy,
                    createdAt: expense.createdAt,
                    flat: expense.flatId,
                    type: 'expense'
                };
            })
            .filter(due => due !== null); // Remove null entries

        // Calculate totals
        const totalBillDue = filteredBillDues.reduce((sum, due) => sum + due.amount, 0);
        const totalExpenseDue = filteredExpenseDues.reduce((sum, due) => sum + due.amount, 0);

        return {
            billDues: filteredBillDues,
            expenseDues: filteredExpenseDues,
            totalBillDue,
            totalExpenseDue,
            totalDue: totalBillDue + totalExpenseDue,
            count: filteredBillDues.length + filteredExpenseDues.length
        };
    }

    /**
     * Get expense history with pagination
     * @param {ObjectId} flatId - Flat ID
     * @param {Object} filters - Query filters
     * @param {Number} page - Page number
     * @param {Number} limit - Items per page
     * @returns {Promise<Object>} Paginated expense history
     */
    async getExpenseHistory(flatId, filters = {}, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const match = { flatId: new mongoose.Types.ObjectId(flatId) };

        if (filters.category) {
            match.category = filters.category;
        }

        if (filters.status) {
            match.status = filters.status;
        }

        if (filters.startDate || filters.endDate) {
            match.dueDate = {};
            if (filters.startDate) match.dueDate.$gte = new Date(filters.startDate);
            if (filters.endDate) match.dueDate.$lte = new Date(filters.endDate);
        }

        // Query bills and expenses in parallel (without skip/limit - we'll apply after combining)
        const [bills, expenses, billCount, expenseCount] = await Promise.all([
            Bill.find(match)
                .populate('createdBy', 'userName email')
                .sort({ createdAt: -1 })
                .lean(),
            
            Expense.find(match)
                .populate('createdBy', 'userName email')
                .populate('participants.userId', 'userName email')
                .sort({ createdAt: -1 })
                .lean(),
            
            Bill.countDocuments(match),
            Expense.countDocuments(match)
        ]);

        // Populate splits for each bill
        const billsWithSplits = await Promise.all(
            bills.map(async (bill) => {
                const splits = await BillSplit.find({ billId: bill._id })
                    .populate('userId', 'userName email')
                    .lean();
                return { ...bill, splits, type: 'bill' };
            })
        );

        // Combine and sort by createdAt
        const combined = [
            ...billsWithSplits,
            ...expenses.map(e => ({ ...e, type: 'expense' }))
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Apply pagination after combining
        const paginatedExpenses = combined.slice(skip, skip + limit);

        return {
            expenses: paginatedExpenses,
            pagination: {
                page,
                limit,
                total: billCount + expenseCount,
                pages: Math.ceil((billCount + expenseCount) / limit)
            }
        };
    }

    /**
     * Record payment for a single expense (bill or split expense)
     * @param {Object} paymentData - Payment details
     * @param {ObjectId} userId - User making the payment
     * @returns {Promise<Object>} Payment result
     */
    async recordPayment(paymentData, userId) {
        console.log('🔵 recordPayment called with:', { paymentData, userId });
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const { expenseId, expenseType, amount, paymentMethod, transactionReference } = paymentData;
            console.log('🔵 Payment details:', { expenseId, expenseType, userId });

            if (expenseType === 'bill') {
                console.log('🔵 Processing bill payment...');
                // Find the bill split for this user
                const billSplit = await BillSplit.findOne({
                    billId: expenseId,
                    userId: userId,
                    status: 'owed'
                }).populate('billId').session(session);

                console.log('🔵 Found billSplit:', billSplit ? 'YES' : 'NO');

                if (!billSplit) {
                    throw new Error("No pending bill split found for this user");
                }

                const bill = billSplit.billId;
                const flatId = bill.flatId;
                console.log('🔵 Creating transaction...');

                // Create transaction
                const transaction = await Transaction.create([{
                    flatId,
                    type: 'payment',
                    amount: billSplit.amount,
                    fromUserId: userId,
                    toUserId: bill.createdBy,
                    billId: bill._id,
                    note: `Payment for ${bill.title}`,
                    paymentMethod: paymentMethod || 'other',
                    transactionReference,
                    status: 'completed'
                }], { session });
                console.log('🔵 Transaction created:', transaction[0]._id);

                // Mark split as paid
                billSplit.status = 'paid';
                billSplit.paidAt = new Date();
                await billSplit.save({ session });
                console.log('🔵 BillSplit marked as paid');

                // Check if all splits are paid and update bill status
                const allSplits = await BillSplit.find({ billId: bill._id }).session(session);
                const allPaid = allSplits.every(split => split.status === 'paid');
                if (allPaid) {
                    bill.status = 'settled';
                    bill.settledAt = new Date();
                }
                await bill.save({ session });
                console.log('🔵 Bill status updated');

                // Update budget snapshot
                const month = new Date().toISOString().slice(0, 7);
                await this._updateBudgetSnapshot(flatId, month, session);

                // Notify bill creator
                if (bill.createdBy.toString() !== userId.toString()) {
                    try {
                        await notifyPaymentReceived(billSplit, bill, { _id: userId });
                    } catch (notifError) {
                        console.error('Failed to send notification:', notifError);
                    }
                }

                await session.commitTransaction();
                console.log('🟢 Bill payment successful!');

                return {
                    transaction: transaction[0],
                    bill,
                    billSplit
                };

            } else {
                console.log('🔵 Processing split expense payment...');
                // Handle split expense payment
                const expense = await Expense.findById(expenseId).session(session);

                if (!expense) {
                    throw new Error("Expense not found");
                }

                // Find user's participation
                const participant = expense.participants.find(
                    p => p.userId.toString() === userId.toString()
                );

                if (!participant) {
                    throw new Error("You are not a participant in this expense");
                }

                if (participant.isPaid) {
                    throw new Error("This expense has already been paid");
                }

                // Create transaction
                const transaction = await Transaction.create([{
                    flatId: expense.flatId,
                    type: 'payment',
                    amount: participant.amount,
                    fromUserId: userId,
                    toUserId: expense.createdBy,
                    expenseId: expense._id,
                    note: `Payment for ${expense.title}`,
                    paymentMethod: paymentMethod || 'other',
                    transactionReference,
                    status: 'completed'
                }], { session });

                console.log('🔵 Transaction created for split expense:', transaction[0]._id);

                // Mark participant as paid
                participant.isPaid = true;
                participant.paidAt = new Date();
                console.log('🔵 Marked participant as paid');

                // Check if all participants have paid
                const allPaid = expense.participants.every(p => p.isPaid);
                if (allPaid) {
                    expense.status = 'settled';
                    expense.settledAt = new Date();
                    console.log('🔵 All participants paid - expense settled');
                }

                await expense.save({ session });
                console.log('🔵 Expense saved');

                // Update budget snapshot
                const month = new Date().toISOString().slice(0, 7);
                await this._updateBudgetSnapshot(expense.flatId, month, session);
                console.log('🔵 Budget snapshot updated');

                console.log('🔵 Budget snapshot updated');

                // Notify expense creator
                if (expense.createdBy.toString() !== userId.toString()) {
                    try {
                        await notifyPaymentReceived(participant, expense, { _id: userId });
                        console.log('🔵 Notification sent');
                    } catch (notifError) {
                        console.error('Failed to send notification:', notifError);
                    }
                }

                await session.commitTransaction();
                console.log('🟢 Split expense payment successful!');

                return {
                    transaction: transaction[0],
                    expense
                };
            }

        } catch (error) {
            console.error('🔴 Payment error:', error);
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Private helper: Update budget snapshot without redundant queries
     * @param {ObjectId} flatId - Flat ID
     * @param {String} month - Month in YYYY-MM format
     * @param {Session} session - Mongoose session
     * @private
     */
    async _updateBudgetSnapshot(flatId, month, session) {
        const flat = await Flat.findById(flatId).session(session);
        if (!flat || flat.monthlyBudget === 0) return;

        let snapshot = await BudgetSnapshot.findOne({ flatId, month }).session(session);
        
        if (!snapshot) {
            snapshot = new BudgetSnapshot({
                flatId,
                month,
                budgetAmount: flat.monthlyBudget,
                predictedAmount: flat.monthlyBudget
            });
        }

        // We'll update actualSpent when financial summary is queried
        // to avoid redundant calculations
        snapshot.budgetAmount = flat.monthlyBudget;
        await snapshot.save({ session });

        return snapshot;
    }

    /**
     * Private helper: Populate expense based on type
     * @param {Object} expense - Expense document
     * @param {String} type - 'shared' or 'split'
     * @private
     */
    async _populateExpense(expense, type) {
        if (type === 'shared') {
            return await Bill.findById(expense._id)
                .populate('createdBy', 'userName email')
                .populate('flatId', 'name');
        } else {
            return await Expense.findById(expense._id)
                .populate('createdBy', 'userName email')
                .populate('participants.userId', 'userName email')
                .populate('flatId', 'name');
        }
    }
}

export default new ExpenseService();
