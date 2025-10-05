import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Payment } from "../models/payment.model.js";
import mongoose from "mongoose";

// Get all payments for a user
const getUserPayments = asyncHandler(async (req, res) => {
    const { status, type } = req.query;
    const userId = req.user._id;

    // Build filter object
    const filter = { userId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const payments = await Payment.find(filter)
        .sort({ dueDate: 1, createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, payments, "Payments fetched successfully")
    );
});

// Get outstanding dues (pending payments)
const getOutstandingDues = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const outstandingDues = await Payment.find({
        userId,
        status: 'pending'
    }).sort({ dueDate: 1 });

    return res.status(200).json(
        new ApiResponse(200, outstandingDues, "Outstanding dues fetched successfully")
    );
});

// Create a new payment/due
const createPayment = asyncHandler(async (req, res) => {
    const {
        title,
        amount,
        recipient,
        dueDate,
        type,
        priority = 'medium',
        notes
    } = req.body;

    // Validation
    if (!title || !amount || !recipient || !dueDate || !type) {
        throw new ApiError(400, "All required fields must be provided");
    }

    if (amount <= 0) {
        throw new ApiError(400, "Amount must be greater than 0");
    }

    const payment = await Payment.create({
        userId: req.user._id,
        title,
        amount,
        recipient,
        dueDate: new Date(dueDate),
        type,
        priority,
        notes
    });

    return res.status(201).json(
        new ApiResponse(201, payment, "Payment created successfully")
    );
});

// Process payment (mark as paid)
const processPayment = asyncHandler(async (req, res) => {
    const { paymentId } = req.params;
    const { paymentMethod, transactionId, processingFee = 0 } = req.body;

    if (!paymentId) {
        throw new ApiError(400, "Payment ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
        throw new ApiError(400, "Invalid payment ID");
    }

    const payment = await Payment.findOne({
        _id: paymentId,
        userId: req.user._id
    });

    if (!payment) {
        throw new ApiError(404, "Payment not found");
    }

    if (payment.status === 'paid') {
        throw new ApiError(400, "Payment is already processed");
    }

    // Update payment status
    payment.status = 'paid';
    payment.paymentMethod = paymentMethod;
    payment.transactionId = transactionId;
    payment.processingFee = processingFee;
    payment.paidAt = new Date();

    await payment.save();

    return res.status(200).json(
        new ApiResponse(200, payment, "Payment processed successfully")
    );
});

// Update payment
const updatePayment = asyncHandler(async (req, res) => {
    const { paymentId } = req.params;
    const updates = req.body;

    if (!paymentId) {
        throw new ApiError(400, "Payment ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
        throw new ApiError(400, "Invalid payment ID");
    }

    const payment = await Payment.findOne({
        _id: paymentId,
        userId: req.user._id
    });

    if (!payment) {
        throw new ApiError(404, "Payment not found");
    }

    // Prevent updating certain fields if payment is already processed
    if (payment.status === 'paid' && (updates.amount || updates.recipient)) {
        throw new ApiError(400, "Cannot update amount or recipient for processed payments");
    }

    const updatedPayment = await Payment.findByIdAndUpdate(
        paymentId,
        { $set: updates },
        { new: true, runValidators: true }
    );

    return res.status(200).json(
        new ApiResponse(200, updatedPayment, "Payment updated successfully")
    );
});

// Delete payment
const deletePayment = asyncHandler(async (req, res) => {
    const { paymentId } = req.params;

    if (!paymentId) {
        throw new ApiError(400, "Payment ID is required");
    }

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
        throw new ApiError(400, "Invalid payment ID");
    }

    const payment = await Payment.findOne({
        _id: paymentId,
        userId: req.user._id
    });

    if (!payment) {
        throw new ApiError(404, "Payment not found");
    }

    if (payment.status === 'paid') {
        throw new ApiError(400, "Cannot delete processed payments");
    }

    await Payment.findByIdAndDelete(paymentId);

    return res.status(200).json(
        new ApiResponse(200, {}, "Payment deleted successfully")
    );
});

// Get payment statistics
const getPaymentStats = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const stats = await Payment.aggregate([
        {
            $match: { userId: new mongoose.Types.ObjectId(userId) }
        },
        {
            $group: {
                _id: null,
                totalPayments: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                paidAmount: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0]
                    }
                },
                pendingAmount: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0]
                    }
                },
                paidCount: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "paid"] }, 1, 0]
                    }
                },
                pendingCount: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "pending"] }, 1, 0]
                    }
                }
            }
        }
    ]);

    const result = stats[0] || {
        totalPayments: 0,
        totalAmount: 0,
        paidAmount: 0,
        pendingAmount: 0,
        paidCount: 0,
        pendingCount: 0
    };

    return res.status(200).json(
        new ApiResponse(200, result, "Payment statistics fetched successfully")
    );
});

export {
    getUserPayments,
    getOutstandingDues,
    createPayment,
    processPayment,
    updatePayment,
    deletePayment,
    getPaymentStats
};