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

            console.log('🔵 [createExpense] Type:', type, 'Participants:', participants.length);

            if (type === 'shared') {
                console.log('🔵 [createExpense] Creating Bill with BillSplits...');
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

                console.log('🔵 [createExpense] Bill created:', bill[0]._id);

                // Create splits
                const amountPerPerson = totalAmount / participants.length;
                
                for (const participant of participants) {
                    const splitData = {
                        billId: bill[0]._id,
                        flatId: flatId,  // ✅ CRITICAL: Add flatId for getUserDues query
                        userId: participant.userId,
                        amount: splitMethod === 'equal' 
                            ? Math.round(amountPerPerson * 100) / 100
                            : participant.amount,
                        status: 'owed'
                    };
                    console.log('🔵 [createExpense] Creating BillSplit:', splitData);
                    
                    const split = await BillSplit.create([splitData], { session });
                    
                    console.log('🔵 [createExpense] BillSplit created:', split[0]._id, 'for user:', split[0].userId);
                    billSplits.push(split[0]);
                }

                console.log('🔵 [createExpense] Total BillSplits created:', billSplits.length);

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
        console.log('🔵 [ExpenseService] getUserDues called:', { userId, flatId });
        
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

        console.log('🔵 [ExpenseService] Raw billDues count:', billDues.length);

        // Filter out any dues where billId is null (bill not in this flat)
        const filteredBillDues = billDues.filter(due => due.billId !== null);
        
        console.log('🔵 [ExpenseService] Filtered billDues count:', filteredBillDues.length);

        // Get user's pending expense participations
        const expenseDues = await Expense.find({
            flatId: flatId,
            'participants.userId': userId,
            'participants.isPaid': false
        })
        .populate('createdBy', 'userName email')
        .populate('flatId', 'name')
        .lean();

        console.log('🔵 [ExpenseService] Raw expenseDues count:', expenseDues.length);
        console.log('🔵 [ExpenseService] ExpenseDues details:', JSON.stringify(expenseDues.map(e => ({
            id: e._id,
            title: e.title,
            participants: e.participants.map(p => ({
                userId: p.userId,
                isPaid: p.isPaid,
                amount: p.amount
            }))
        })), null, 2));

        // Extract only the user's participation from each expense
        const filteredExpenseDues = expenseDues
            .map(expense => {
                const userParticipation = expense.participants.find(
                    p => p.userId.toString() === userId.toString() && !p.isPaid
                );
                
                // If user has already paid, skip this expense
                if (!userParticipation) {
                    console.log('⚠️ [ExpenseService] No unpaid participation for expense:', expense._id);
                    return null;
                }
                
                console.log('✅ [ExpenseService] Found unpaid participation:', {
                    expenseId: expense._id,
                    userId: userParticipation.userId,
                    amount: userParticipation.amount,
                    isPaid: userParticipation.isPaid
                });
                
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

        console.log('🔵 [ExpenseService] Filtered expenseDues count:', filteredExpenseDues.length);

        // Calculate totals
        const totalBillDue = filteredBillDues.reduce((sum, due) => sum + due.amount, 0);
        const totalExpenseDue = filteredExpenseDues.reduce((sum, due) => sum + due.amount, 0);

        const result = {
            billDues: filteredBillDues,
            expenseDues: filteredExpenseDues,
            totalBillDue,
            totalExpenseDue,
            totalDue: totalBillDue + totalExpenseDue,
            count: filteredBillDues.length + filteredExpenseDues.length
        };

        console.log('✅ [ExpenseService] getUserDues result:', {
            billDuesCount: result.billDues.length,
            expenseDuesCount: result.expenseDues.length,
            totalDue: result.totalDue
        });

        return result;
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

                // Mark as paid WITH session for atomic update
                billSplit.status = 'paid';
                billSplit.paidAt = new Date();
                billSplit.transactionId = transaction[0]._id;
                await billSplit.save({ session });
                console.log('🔵 BillSplit marked as paid, new status:', billSplit.status);
                
                // Verify the update by querying it back
                const verifyUpdate = await BillSplit.findById(billSplit._id).session(session);
                console.log('🔵 Verification - BillSplit status in DB:', verifyUpdate?.status);
                
                // Update bill status in the same transaction
                await bill.updateStatus({ session });
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
     * Private helper: Update budget snapshot with actual spending
     * @param {ObjectId} flatId - Flat ID
     * @param {String} month - Month in YYYY-MM format
     * @param {Session} session - Mongoose session
     * @private
     */
    async _updateBudgetSnapshot(flatId, month, session) {
        console.log('💰 [_updateBudgetSnapshot] Updating budget for flat:', flatId, 'month:', month);
        
        const flat = await Flat.findById(flatId).session(session);
        if (!flat || flat.monthlyBudget === 0) {
            console.log('💰 [_updateBudgetSnapshot] No budget set for flat');
            return;
        }

        let snapshot = await BudgetSnapshot.findOne({ flatId, month }).session(session);
        
        if (!snapshot) {
            console.log('💰 [_updateBudgetSnapshot] Creating new snapshot');
            snapshot = new BudgetSnapshot({
                flatId,
                month,
                budgetAmount: flat.monthlyBudget,
                predictedAmount: flat.monthlyBudget,
                actualSpent: 0
            });
        }

        // Calculate actual spent from completed transactions this month
        const startDate = new Date(month + '-01');
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);
        
        const transactions = await Transaction.find({
            flatId,
            type: 'payment',
            status: 'completed',
            createdAt: { $gte: startDate, $lt: endDate }
        }).session(session);
        
        const actualSpent = transactions.reduce((sum, txn) => sum + txn.amount, 0);
        
        console.log('💰 [_updateBudgetSnapshot] Calculated spending:', {
            transactions: transactions.length,
            actualSpent: actualSpent,
            budget: flat.monthlyBudget
        });

        // Update snapshot
        snapshot.budgetAmount = flat.monthlyBudget;
        snapshot.actualSpent = actualSpent;
        snapshot.predictedAmount = flat.monthlyBudget; // Can be enhanced with ML prediction
        
        await snapshot.save({ session });
        console.log('💰 [_updateBudgetSnapshot] Budget snapshot updated');

        return snapshot;
    }

    /**
     * Get user's pending dues for a flat
     * @param {ObjectId} userId - User ID
     * @param {ObjectId} flatId - Flat ID
     * @returns {Promise<Object>} User's pending dues
     */
    async getUserDues(userId, flatId) {
        try {
            console.log('📋 [getUserDues] ===== START =====');
            console.log('📋 [getUserDues] Fetching dues for user:', userId, 'flat:', flatId);

            // Get pending bill splits (status = 'owed')
            // Try with flatId first, if no results, fetch all and filter by populated billId.flatId
            const query = {
                userId,
                flatId,
                status: 'owed'
            };
            console.log('📋 [getUserDues] Query:', JSON.stringify(query));
            
            let billSplits = await BillSplit.find(query)
            .populate({
                path: 'billId',
                select: 'title description vendor totalAmount dueDate category createdAt flatId',
                populate: {
                    path: 'createdBy',
                    select: 'userName email'
                }
            })
            .sort({ dueDate: 1 })
            .lean();

            console.log('📋 [getUserDues] Found with flatId:', billSplits.length);
            
            // Debug: Log all splits for this user regardless of status
            const allUserSplits = await BillSplit.find({ userId }).lean();
            console.log('📋 [getUserDues] Total splits for user (all statuses):', allUserSplits.length);
            allUserSplits.forEach(split => {
                console.log('📋 [getUserDues] Split:', {
                    billId: split.billId,
                    flatId: split.flatId,
                    status: split.status,
                    amount: split.amount,
                    paidAt: split.paidAt
                });
            });

            // Fallback: If flatId field doesn't exist in old records, fetch without flatId and filter
            if (billSplits.length === 0) {
                console.log('📋 [getUserDues] No splits found with flatId, trying without flatId filter...');
                const allUserSplits = await BillSplit.find({
                    userId,
                    status: 'owed'
                })
                .populate({
                    path: 'billId',
                    select: 'title description vendor totalAmount dueDate category createdAt flatId',
                    populate: {
                        path: 'createdBy',
                        select: 'userName email'
                    }
                })
                .sort({ dueDate: 1 })
                .lean();
                
                // Filter by bill's flatId
                billSplits = allUserSplits.filter(split => 
                    split.billId && split.billId.flatId?.toString() === flatId.toString()
                );
                console.log('📋 [getUserDues] Filtered', billSplits.length, 'splits by bill flatId');
            }

            console.log('📋 [getUserDues] Found', billSplits.length, 'pending bill splits');

            // Get pending split expenses where THIS SPECIFIC USER hasn't paid
            // Use $elemMatch to filter by userId AND isPaid in same array element
            const expenses = await Expense.find({
                flatId,
                participants: {
                    $elemMatch: {
                        userId: userId,
                        isPaid: false
                    }
                },
                status: { $in: ['pending', 'active'] }  // Only active expenses
            })
            .populate('createdBy', 'userName email')
            .sort({ createdAt: -1 })
            .lean();

            console.log('📋 [getUserDues] Found', expenses.length, 'pending split expenses');
            
            // Debug: Log each expense with user's payment status
            expenses.forEach(exp => {
                const userPart = exp.participants.find(p => p.userId.toString() === userId.toString());
                console.log('📋 [getUserDues] Expense:', exp.title, '- User isPaid:', userPart?.isPaid);
            });

            // Format bill dues - ADD billId field for frontend compatibility
            const billDues = billSplits
                .filter(split => split.billId)  // Filter out any orphaned splits
                .map(split => ({
                    _id: split.billId._id,
                    billId: split.billId._id,  // CRITICAL: Frontend checks for this
                    expenseType: 'shared',
                    title: split.billId.title,
                    description: split.billId.description,
                    vendor: split.billId.vendor,
                    category: split.billId.category,
                    totalAmount: split.billId.totalAmount,
                    userAmount: split.amount,
                    dueDate: split.billId.dueDate,
                    createdBy: split.billId.createdBy,
                    createdAt: split.billId.createdAt
                }));

            // Format expense dues - ADD expenseId field
            const expenseDues = expenses.map(expense => {
                const userParticipant = expense.participants.find(
                    p => p.userId.toString() === userId.toString()
                );
                
                console.log('📋 [getUserDues] Mapping expense:', {
                    title: expense.title,
                    userParticipantFound: !!userParticipant,
                    participantAmount: userParticipant?.amount,
                    participantShare: userParticipant?.share,
                    allParticipants: expense.participants.map(p => ({
                        userId: p.userId,
                        amount: p.amount,
                        share: p.share,
                        isPaid: p.isPaid
                    }))
                });
                
                return {
                    _id: expense._id,
                    expenseId: expense._id,  // CRITICAL: Frontend checks for this
                    expenseType: 'split',
                    title: expense.title,
                    description: expense.description,
                    category: expense.category,
                    totalAmount: expense.totalAmount,
                    userAmount: userParticipant?.amount || 0,
                    createdBy: expense.createdBy,
                    createdAt: expense.createdAt
                };
            });

            // Calculate totals
            const totalBillDue = billDues.reduce((sum, bill) => sum + bill.userAmount, 0);
            const totalExpenseDue = expenseDues.reduce((sum, exp) => sum + exp.userAmount, 0);
            const totalDue = totalBillDue + totalExpenseDue;

            console.log('📋 [getUserDues] Totals - Bills:', totalBillDue, 'Expenses:', totalExpenseDue, 'Total:', totalDue);

            const result = {
                billDues,
                expenseDues,
                totalBillDue,
                totalExpenseDue,
                totalDue
            };
            
            // Log the exact structure being returned
            if (expenseDues.length > 0) {
                console.log('📋 [getUserDues] First expense due structure:', JSON.stringify(expenseDues[0], null, 2));
            }
            
            return result;

        } catch (error) {
            console.error('❌ [getUserDues] Error:', error);
            throw error;
        }
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
