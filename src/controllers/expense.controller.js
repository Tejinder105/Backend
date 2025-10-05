import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Expense } from "../models/expense.model.js";
import { Flatmate } from "../models/flatmate.model.js";
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

    // Check if user is the creator of the expense
    if (expense.createdBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the expense creator can mark payments as paid");
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

    const flatmates = await Flatmate.find({
        status: 'active'
    }).populate('userId', 'userName email');

    // Include current user as well
    const currentUser = req.user;
    const allParticipants = [
        {
            _id: currentUser._id,
            userId: {
                _id: currentUser._id,
                userName: currentUser.userName,
                email: currentUser.email
            },
            name: currentUser.userName,
            isCurrentUser: true
        },
        ...flatmates.map(flatmate => ({
            ...flatmate.toObject(),
            isCurrentUser: false
        }))
    ];

    return res.status(200).json(
        new ApiResponse(200, allParticipants, "Available flatmates fetched successfully")
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
    getAvailableFlatmates
};