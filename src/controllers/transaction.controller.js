import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Transaction } from "../models/transaction.model.js";
import { BillSplit } from "../models/billSplit.model.js";
import { Flat } from "../models/flat.model.js";
import { Bill } from "../models/bill.model.js";
import { notifyPaymentReceived } from "../services/notification.service.js";
import mongoose from "mongoose";

// Pay multiple dues at once
export const payDues = asyncHandler(async (req, res) => {
    const { billSplitIds, paymentMethod, transactionReference, note } = req.body;
    const userId = req.user._id;

    if (!billSplitIds || billSplitIds.length === 0) {
        throw new ApiError(400, "Bill split IDs are required");
    }

    // Fetch all bill splits
    const billSplits = await BillSplit.find({
        _id: { $in: billSplitIds },
        userId: userId,
        status: 'owed'
    }).populate('billId');

    if (billSplits.length === 0) {
        throw new ApiError(404, "No pending dues found");
    }

    // Verify all bill splits belong to same flat
    const flatIds = [...new Set(billSplits.map(split => split.billId.flatId.toString()))];
    if (flatIds.length > 1) {
        throw new ApiError(400, "All dues must belong to the same flat");
    }

    const flatId = flatIds[0];
    const totalAmount = billSplits.reduce((sum, split) => sum + split.amount, 0);

    // Create transaction
    const transaction = await Transaction.createPayment({
        flatId,
        amount: totalAmount,
        fromUserId: userId,
        toUserId: null,
        billId: null,
        note: note || `Payment for ${billSplits.length} bill(s)`,
        paymentMethod: paymentMethod || 'other',
        transactionReference
    });

    // Mark all bill splits as paid
    const updatedSplits = [];
    for (const split of billSplits) {
        await split.markPaid(transaction._id);
        updatedSplits.push(split);

        // Notify bill creator
        const bill = await Bill.findById(split.billId).populate('createdBy');
        if (bill && bill.createdBy._id.toString() !== userId.toString()) {
            await notifyPaymentReceived(split, bill, req.user);
        }
    }

    return res.status(200).json(
        new ApiResponse(200, {
            transaction,
            paidSplits: updatedSplits,
            totalAmount
        }, "Payment processed successfully")
    );
});

// Create manual transaction (adjustment/refund)
export const createTransaction = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const {
        type,
        amount,
        toUserId,
        billId,
        note,
        paymentMethod,
        transactionReference
    } = req.body;

    // Verify flat and admin access
    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id)) {
        throw new ApiError(403, "Only flat admin can create manual transactions");
    }

    const transaction = await Transaction.create({
        flatId,
        type,
        amount,
        fromUserId: req.user._id,
        toUserId,
        billId,
        note,
        paymentMethod: paymentMethod || 'other',
        transactionReference
    });

    const populatedTransaction = await Transaction.findById(transaction._id)
        .populate('fromUserId', 'userName email')
        .populate('toUserId', 'userName email')
        .populate('billId', 'title');

    return res.status(201).json(
        new ApiResponse(201, populatedTransaction, "Transaction created successfully")
    );
});

// Get flat transactions
export const getFlatTransactions = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { type, startDate, endDate, limit = 50 } = req.query;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    const filter = { flatId };
    
    if (type) filter.type = type;
    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(filter)
        .populate('fromUserId', 'userName email')
        .populate('toUserId', 'userName email')
        .populate('billId', 'title')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit));

    const summary = await Transaction.getSummary(flatId);

    return res.status(200).json(
        new ApiResponse(200, { transactions, summary }, "Transactions fetched successfully")
    );
});

// Get user transactions
export const getUserTransactions = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { type, startDate, endDate, limit = 50 } = req.query;
    const requestUserId = userId || req.user._id;

    const filter = {
        $or: [
            { fromUserId: requestUserId },
            { toUserId: requestUserId }
        ]
    };

    if (type) filter.type = type;
    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const transactions = await Transaction.find(filter)
        .populate('fromUserId', 'userName email')
        .populate('toUserId', 'userName email')
        .populate('billId', 'title')
        .populate('flatId', 'name')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit));

    return res.status(200).json(
        new ApiResponse(200, transactions, "User transactions fetched successfully")
    );
});

// Get transaction summary
export const getTransactionSummary = asyncHandler(async (req, res) => {
    const { flatId } = req.params;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    const summary = await Transaction.getSummary(flatId);
    
    // Get total dues
    const totalDues = await BillSplit.aggregate([
        {
            $lookup: {
                from: 'bills',
                localField: 'billId',
                foreignField: '_id',
                as: 'bill'
            }
        },
        {
            $unwind: '$bill'
        },
        {
            $match: {
                'bill.flatId': new mongoose.Types.ObjectId(flatId),
                status: 'owed'
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$amount' },
                count: { $sum: 1 }
            }
        }
    ]);

    return res.status(200).json(
        new ApiResponse(200, {
            transactionSummary: summary,
            pendingDues: totalDues[0] || { total: 0, count: 0 }
        }, "Transaction summary fetched successfully")
    );
});
