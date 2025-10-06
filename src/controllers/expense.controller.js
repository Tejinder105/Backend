import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Expense } from "../models/expense.model.js";
import mongoose from "mongoose";

// Get all expenses for a user (created by them or they are a participant)
const getUserExpenses = asyncHandler(async (req, res) => {
    const { status, category } = req.query;
    const userId = req.user._id;

    // Build filter object
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

// Get expenses created by the user
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

// Get expenses where user is a participant
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

// Create a new split expense
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

    // Validation
    if (!title || !description || !totalAmount || !category || !participants) {
        throw new ApiError(400, "All required fields must be provided");
    }

    if (totalAmount <= 0) {
        throw new ApiError(400, "Total amount must be greater than 0");
    }

    if (!Array.isArray(participants) || participants.length === 0) {
        throw new ApiError(400, "At least one participant is required");
    }

    // Validate participants
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

    // Validate total for custom split
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

    return res.status(201).json(
        new ApiResponse(201, populatedExpense, "Split expense created successfully")
    );
});

// Mark participant payment as paid
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

    // Allow both the creator and the participant themselves to mark as paid
    const isCreator = expense.createdBy.toString() === req.user._id.toString();
    const isParticipant = participantUserId === req.user._id.toString();

    if (!isCreator && !isParticipant) {
        throw new ApiError(403, "Only the expense creator or the participant can mark this payment as paid");
    }

    // Find and update the participant
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

    // Check if all participants have paid
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

// Update expense
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

    // Check if user is the creator of the expense
    if (expense.createdBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the expense creator can update the expense");
    }

    // Prevent updating if expense is settled
    if (expense.status === 'settled') {
        throw new ApiError(400, "Cannot update settled expenses");
    }

    // Prevent updating certain fields if any participant has paid
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

// Delete expense
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

    // Check if user is the creator of the expense
    if (expense.createdBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the expense creator can delete the expense");
    }

    // Prevent deletion if any participant has paid
    const anyPaid = expense.participants.some(p => p.isPaid);
    if (anyPaid) {
        throw new ApiError(400, "Cannot delete expense after payments have been made");
    }

    await Expense.findByIdAndDelete(expenseId);

    return res.status(200).json(
        new ApiResponse(200, {}, "Expense deleted successfully")
    );
});

// Get expense statistics
const getExpenseStats = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // Stats for expenses created by user
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

    // Stats for expenses where user is a participant
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

// Get available flatmates for expense splitting
const getAvailableFlatmates = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const currentUserName = req.user.userName;
    const currentUserEmail = req.user.email;

    console.log('🔍 getAvailableFlatmates called by userId:', userId.toString());

    // Import Flat model
    const { Flat } = await import("../models/flat.model.js");

    // Find the user's flat
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

    // Get all available flatmates (admin + members + current user)
    const availableFlatmates = [];

    // Add current user first
    console.log('  → Current User:', currentUserName, '| ID:', userId.toString());
    availableFlatmates.push({
        _id: userId,
        name: currentUserName,
        userName: currentUserName,
        email: currentUserEmail,
        role: flat.admin._id.toString() === userId.toString() ? 'admin' : 'member',
        isCurrentUser: true
    });

    // Add admin if admin is not the current user
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

    // Add active members, excluding the current user AND the admin (to avoid duplicates)
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

// Get all flat expenses (all expenses involving any flat member)
const getFlatExpenses = asyncHandler(async (req, res) => {
    const { status, category } = req.query;
    const userId = req.user._id;

    console.log('🔍 getFlatExpenses called by userId:', userId.toString());

    // First, find the user's flat and get all member IDs
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

    // Get all active member IDs from the flat
    const memberIds = flat.members
        .filter(member => member.status === 'active')
        .map(member => member.userId);

    console.log('📋 Active member IDs:', memberIds.map(id => id.toString()));

    // Build filter to get all expenses involving any flat member
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
    getFlatExpenses
};