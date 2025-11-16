import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Expense } from "../models/expense.model.js";
import { notifyExpenseCreated } from "../services/notification.service.js";
import ExpenseService from "../services/expense.service.js";
import mongoose from "mongoose";

const getUserExpenses = asyncHandler(async (req, res) => {
    const { status, category } = req.query;
    const userId = req.user._id;


    const filter = {
        $or: [
            { createdBy: userId },
            { "participants.userId": userId }
        ]
    };

    if (status) filter.status = status;
    if (category) filter.category = category;

    const expenses = await Expense.find(filter)
        .populate('createdBy', 'userName email')
        .populate('participants.userId', 'userName email')
        .sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, expenses, "Expenses fetched successfully")
    );
});

const getCreatedExpenses = asyncHandler(async (req, res) => {
    const { status, category } = req.query;
    const userId = req.user._id;

    const filter = { createdBy: userId };
    if (status) filter.status = status;
    if (category) filter.category = category;

    const expenses = await Expense.find(filter)
        .populate('participants.userId', 'userName email')
        .sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, expenses, "Created expenses fetched successfully")
    );
});

const getParticipantExpenses = asyncHandler(async (req, res) => {
    const { status, category } = req.query;
    const userId = req.user._id;

    const filter = {
        "participants.userId": userId,
        createdBy: { $ne: userId } // Exclude expenses created by the user
    };

    if (status) filter.status = status;
    if (category) filter.category = category;

    const expenses = await Expense.find(filter)
        .populate('createdBy', 'userName email')
        .populate('participants.userId', 'userName email')
        .sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, expenses, "Participant expenses fetched successfully")
    );
});

const createSplitExpense = asyncHandler(async (req, res) => {
    const {
        title,
        description,
        totalAmount,
        category,
        splitMethod = 'equal',
        participants,
        notes
    } = req.body;

    if (!title || !description || !totalAmount || !category || !participants) {
        throw new ApiError(400, "All required fields must be provided");
    }

    if (totalAmount <= 0) {
        throw new ApiError(400, "Total amount must be greater than 0");
    }

    if (!Array.isArray(participants) || participants.length === 0) {
        throw new ApiError(400, "At least one participant is required");
    }

    const validParticipants = [];
    let calculatedTotal = 0;

    for (const participant of participants) {
        if (!participant.userId || !participant.name) {
            throw new ApiError(400, "Each participant must have userId and name");
        }

        let amount;
        if (splitMethod === 'equal') {
            amount = totalAmount / participants.length;
        } else if (splitMethod === 'custom') {
            if (!participant.amount || participant.amount <= 0) {
                throw new ApiError(400, "Custom amounts must be provided and greater than 0");
            }
            amount = participant.amount;
        }

        validParticipants.push({
            userId: new mongoose.Types.ObjectId(participant.userId),
            name: participant.name,
            amount: Math.round(amount * 100) / 100, // Round to 2 decimal places
            isPaid: false
        });

        calculatedTotal += amount;
    }

    if (splitMethod === 'custom' && Math.abs(calculatedTotal - totalAmount) > 0.01) {
        throw new ApiError(400, "Custom amounts must sum up to total amount");
    }

    const expense = await Expense.create({
        createdBy: req.user._id,
        title,
        description,
        totalAmount,
        category,
        splitMethod,
        participants: validParticipants,
        notes
    });

    const populatedExpense = await Expense.findById(expense._id)
        .populate('createdBy', 'userName email')
        .populate('participants.userId', 'userName email');

    // Send notifications to all participants (except creator)
    try {
        console.log('💬 Attempting to send expense notifications...');
        console.log('Creator:', req.user.userName);
        console.log('Participants:', populatedExpense.participants.length);
        await notifyExpenseCreated(populatedExpense, req.user.userName);
        console.log('✅ Expense notifications sent successfully');
    } catch (notifError) {
        console.error('❌ Failed to send expense notifications:', notifError);
        // Don't fail the request if notifications fail
    }

    return res.status(201).json(
        new ApiResponse(201, populatedExpense, "Split expense created successfully")
    );
});

const markParticipantPaid = asyncHandler(async (req, res) => {
    const { expenseId, participantUserId } = req.params;

    if (!expenseId || !participantUserId) {
        throw new ApiError(400, "Expense ID and participant user ID are required");
    }

    if (!mongoose.Types.ObjectId.isValid(expenseId) || !mongoose.Types.ObjectId.isValid(participantUserId)) {
        throw new ApiError(400, "Invalid expense ID or participant user ID");
    }

    const expense = await Expense.findById(expenseId);

    if (!expense) {
        throw new ApiError(404, "Expense not found");
    }

    const isCreator = expense.createdBy.toString() === req.user._id.toString();
    const isParticipant = participantUserId === req.user._id.toString();

    if (!isCreator && !isParticipant) {
        throw new ApiError(403, "Only the expense creator or the participant can mark this payment as paid");
    }

    const participant = expense.participants.find(p => 
        p.userId.toString() === participantUserId
    );

    if (!participant) {
        throw new ApiError(404, "Participant not found in this expense");
    }

    if (participant.isPaid) {
        throw new ApiError(400, "Participant has already paid");
    }

    participant.isPaid = true;
    participant.paidAt = new Date();

    const allPaid = expense.participants.every(p => p.isPaid);
    if (allPaid) {
        expense.status = 'settled';
        expense.settledAt = new Date();
    }

    await expense.save();

    const populatedExpense = await Expense.findById(expense._id)
        .populate('createdBy', 'userName email')
        .populate('participants.userId', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, populatedExpense, "Participant payment marked as paid")
    );
});

const updateExpense = asyncHandler(async (req, res) => {
    const { expenseId } = req.params;
    const updates = req.body;

    if (!expenseId) {
        throw new ApiError(400, "Expense ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(expenseId)) {
        throw new ApiError(400, "Invalid expense ID");
    }

    const expense = await Expense.findById(expenseId);

    if (!expense) {
        throw new ApiError(404, "Expense not found");
    }

    if (expense.createdBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the expense creator can update the expense");
    }

    if (expense.status === 'settled') {
        throw new ApiError(400, "Cannot update settled expenses");
    }

    const anyPaid = expense.participants.some(p => p.isPaid);
    if (anyPaid && (updates.totalAmount || updates.participants)) {
        throw new ApiError(400, "Cannot update amount or participants after payments have been made");
    }

    const updatedExpense = await Expense.findByIdAndUpdate(
        expenseId,
        { $set: updates },
        { new: true, runValidators: true }
    ).populate('createdBy', 'userName email')
     .populate('participants.userId', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, updatedExpense, "Expense updated successfully")
    );
});

const deleteExpense = asyncHandler(async (req, res) => {
    const { expenseId } = req.params;

    if (!expenseId) {
        throw new ApiError(400, "Expense ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(expenseId)) {
        throw new ApiError(400, "Invalid expense ID");
    }

    const expense = await Expense.findById(expenseId);

    if (!expense) {
        throw new ApiError(404, "Expense not found");
    }

    if (expense.createdBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the expense creator can delete the expense");
    }

    const anyPaid = expense.participants.some(p => p.isPaid);
    if (anyPaid) {
        throw new ApiError(400, "Cannot delete expense after payments have been made");
    }

    await Expense.findByIdAndDelete(expenseId);

    return res.status(200).json(
        new ApiResponse(200, {}, "Expense deleted successfully")
    );
});

const getExpenseStats = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const createdStats = await Expense.aggregate([
        {
            $match: { createdBy: new mongoose.Types.ObjectId(userId) }
        },
        {
            $group: {
                _id: null,
                totalExpenses: { $sum: 1 },
                totalAmount: { $sum: "$totalAmount" },
                settledCount: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "settled"] }, 1, 0]
                    }
                },
                activeCount: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "active"] }, 1, 0]
                    }
                }
            }
        }
    ]);

    const participantStats = await Expense.aggregate([
        {
            $match: { "participants.userId": new mongoose.Types.ObjectId(userId) }
        },
        {
            $unwind: "$participants"
        },
        {
            $match: { "participants.userId": new mongoose.Types.ObjectId(userId) }
        },
        {
            $group: {
                _id: null,
                totalOwed: { $sum: "$participants.amount" },
                paidAmount: {
                    $sum: {
                        $cond: ["$participants.isPaid", "$participants.amount", 0]
                    }
                },
                pendingAmount: {
                    $sum: {
                        $cond: ["$participants.isPaid", 0, "$participants.amount"]
                    }
                },
                totalParticipations: { $sum: 1 }
            }
        }
    ]);

    const created = createdStats[0] || {
        totalExpenses: 0,
        totalAmount: 0,
        settledCount: 0,
        activeCount: 0
    };

    const participant = participantStats[0] || {
        totalOwed: 0,
        paidAmount: 0,
        pendingAmount: 0,
        totalParticipations: 0
    };

    return res.status(200).json(
        new ApiResponse(200, { created, participant }, "Expense statistics fetched successfully")
    );
});

const getAvailableFlatmates = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const currentUserName = req.user.userName;
    const currentUserEmail = req.user.email;

    console.log('🔍 getAvailableFlatmates called by userId:', userId.toString());

    const { Flat } = await import("../models/flat.model.js");

    const flat = await Flat.findOne({
        $or: [
            { admin: userId },
            { 'members.userId': userId, 'members.status': 'active' }
        ],
        status: 'active'
    })
    .populate('admin', 'userName email')
    .populate('members.userId', 'userName email');

    if (!flat) {
        console.log('❌ User is not part of any active flat');
        return res.status(200).json(
            new ApiResponse(200, [], "You are not part of any active flat")
        );
    }

    console.log('✅ Found flat:', flat.name, '| Admin:', flat.admin._id.toString(), '| Members:', flat.members.length);

    const availableFlatmates = [];

    console.log('  → Current User:', currentUserName, '| ID:', userId.toString());
    availableFlatmates.push({
        _id: userId,
        name: currentUserName,
        userName: currentUserName,
        email: currentUserEmail,
        role: flat.admin._id.toString() === userId.toString() ? 'admin' : 'member',
        isCurrentUser: true
    });

    if (flat.admin._id.toString() !== userId.toString()) {
        console.log('  → Admin:', flat.admin.userName, '| ID:', flat.admin._id.toString());
        
        availableFlatmates.push({
            _id: flat.admin._id,
            name: flat.admin.userName,
            userName: flat.admin.userName,
            email: flat.admin.email,
            role: 'admin',
            isCurrentUser: false
        });
    }

    flat.members
        .filter(member => {
            const isCurrentUser = member.userId._id.toString() === userId.toString();
            const isAdmin = member.userId._id.toString() === flat.admin._id.toString();
            const isActive = member.status === 'active';
            return isActive && !isCurrentUser && !isAdmin; // Exclude current user AND admin
        })
        .forEach(member => {
            console.log('  → Member:', member.userId.userName, '| ID:', member.userId._id.toString());
            
            availableFlatmates.push({
                _id: member.userId._id,
                name: member.userId.userName,
                userName: member.userId.userName,
                email: member.userId.email,
                role: member.role,
                isCurrentUser: false
            });
        });

    console.log('📤 Returning', availableFlatmates.length, 'available flatmates (including current user)');

    return res.status(200).json(
        new ApiResponse(200, availableFlatmates, "Available flatmates fetched successfully")
    );
});

const getFlatExpenses = asyncHandler(async (req, res) => {
    const { status, category } = req.query;
    const userId = req.user._id;

    console.log('🔍 getFlatExpenses called by userId:', userId.toString());

    const { Flat } = await import("../models/flat.model.js");
    
    const flat = await Flat.findOne({
        $or: [
            { admin: userId },
            { 'members.userId': userId, 'members.status': 'active' }
        ],
        status: 'active'
    });

    if (!flat) {
        console.log('❌ User is not part of any active flat');
        throw new ApiError(404, "You are not part of any active flat");
    }

    console.log('✅ Found flat:', flat._id, 'Name:', flat.name);

    const memberIds = flat.members
        .filter(member => member.status === 'active')
        .map(member => member.userId);

    console.log('📋 Active member IDs:', memberIds.map(id => id.toString()));

    const filter = {
        $or: [
            { createdBy: { $in: memberIds } },
            { "participants.userId": { $in: memberIds } }
        ]
    };

    if (status) filter.status = status;
    if (category) filter.category = category;

    console.log('🔎 Searching for expenses with filter:', JSON.stringify(filter, null, 2));

    const expenses = await Expense.find(filter)
        .populate('createdBy', 'userName email')
        .populate('participants.userId', 'userName email')
        .sort({ createdAt: -1 });

    console.log('✅ Found', expenses.length, 'expenses');
    expenses.forEach(exp => {
        console.log('  - Expense:', exp.title, '| Creator:', exp.createdBy?.userName, '| Participants:', exp.participants?.length);
        exp.participants?.forEach(p => {
            console.log('    → Participant:', p.userId?.userName || 'Unknown', '| ID:', p.userId?._id?.toString() || p.userId?.toString() || 'NO ID', '| Amount:', p.amount);
        });
    });

    return res.status(200).json(
        new ApiResponse(200, expenses, "Flat expenses fetched successfully")
    );
});

// ==================== NEW UNIFIED ENDPOINTS USING EXPENSESERVICE ====================

/**
 * Create unified expense (bills or split expenses)
 * Uses ExpenseService for transactional safety and unified logic
 */
const createUnifiedExpense = asyncHandler(async (req, res) => {
    const { 
        flatId, 
        type = 'split', // 'shared' (bill) or 'split' (expense)
        title,
        description,
        vendor,
        totalAmount,
        dueDate,
        category,
        splitMethod = 'equal',
        participants,
        notes,
        isRecurring = false,
        recurrenceRule,
        imageUrl
    } = req.body;

    // Validation
    if (!flatId || !title || !totalAmount || !participants || participants.length === 0) {
        throw new ApiError(400, "Missing required fields: flatId, title, totalAmount, participants");
    }

    if (totalAmount <= 0) {
        throw new ApiError(400, "Total amount must be greater than 0");
    }

    // Call ExpenseService
    const result = await ExpenseService.createExpense({
        flatId,
        type,
        title,
        description,
        vendor,
        totalAmount,
        dueDate,
        category,
        splitMethod,
        participants,
        notes,
        isRecurring,
        recurrenceRule,
        imageUrl
    }, req.user._id);

    return res.status(201).json(
        new ApiResponse(201, result, `${type === 'shared' ? 'Bill' : 'Expense'} created successfully`)
    );
});

/**
 * Record bulk payment for multiple expenses
 * Uses ExpenseService for transactional safety
 */
const recordBulkPayment = asyncHandler(async (req, res) => {
    const {
        payments // Array of { expenseId, expenseType, amount, paymentMethod, transactionReference }
    } = req.body;

    if (!payments || !Array.isArray(payments) || payments.length === 0) {
        throw new ApiError(400, "Payments array is required");
    }

    const results = [];
    const errors = [];

    // Process each payment
    for (const payment of payments) {
        try {
            const { expenseId, expenseType, amount, paymentMethod, transactionReference } = payment;

            if (!expenseId || !expenseType) {
                errors.push({ expenseId, error: "Missing expenseId or expenseType" });
                continue;
            }

            const result = await ExpenseService.recordPayment({
                expenseId,
                expenseType,
                userId: req.user._id,
                amount,
                paymentMethod: paymentMethod || 'other',
                transactionReference
            }, req.user._id);

            results.push({ expenseId, success: true, data: result });
        } catch (error) {
            errors.push({ expenseId: payment.expenseId, error: error.message });
        }
    }

    return res.status(200).json(
        new ApiResponse(200, { 
            successful: results.length,
            failed: errors.length,
            results,
            errors
        }, "Bulk payment processing completed")
    );
});

/**
 * Get combined user dues (bills + expenses)
 * Uses ExpenseService for unified query
 */
const getUserDues = asyncHandler(async (req, res) => {
    const { flatId } = req.query;

    if (!flatId) {
        throw new ApiError(400, "flatId is required");
    }

    const dues = await ExpenseService.getUserDues(req.user._id, flatId);

    // Set cache headers for 5 minutes (current month data changes frequently)
    res.set('Cache-Control', 'private, max-age=300'); // 5 minutes
    res.set('ETag', `W/"${Date.now()}"`);

    return res.status(200).json(
        new ApiResponse(200, dues, "User dues fetched successfully")
    );
});

/**
 * Get expense history with pagination
 * Uses ExpenseService for optimized query
 */
const getExpenseHistory = asyncHandler(async (req, res) => {
    const { 
        flatId, 
        status, 
        category, 
        startDate, 
        endDate,
        page = 1,
        limit = 20
    } = req.query;

    if (!flatId) {
        throw new ApiError(400, "flatId is required");
    }

    const filters = {};
    if (status) filters.status = status;
    if (category) filters.category = category;
    if (startDate) filters.startDate = new Date(startDate);
    if (endDate) filters.endDate = new Date(endDate);

    const history = await ExpenseService.getExpenseHistory(
        flatId, 
        filters, 
        parseInt(page), 
        parseInt(limit)
    );

    // Set cache headers - longer TTL for historical data
    const isHistorical = startDate && new Date(startDate) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cacheAge = isHistorical ? 3600 : 300; // 1 hour for old data, 5 min for recent
    res.set('Cache-Control', `private, max-age=${cacheAge}`);

    return res.status(200).json(
        new ApiResponse(200, history, "Expense history fetched successfully")
    );
});

export {
    getUserExpenses,
    getCreatedExpenses,
    getParticipantExpenses,
    createSplitExpense,
    markParticipantPaid,
    updateExpense,
    deleteExpense,
    getExpenseStats,
    getAvailableFlatmates,
    getFlatExpenses,
    // New unified endpoints
    createUnifiedExpense,
    recordBulkPayment,
    getUserDues,
    getExpenseHistory
};