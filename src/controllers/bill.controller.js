import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Bill } from "../models/bill.model.js";
import { BillSplit } from "../models/billSplit.model.js";
import { Flat } from "../models/flat.model.js";
import { processBillImage } from "../services/ocr.service.js";
import { uploadBillImage } from "../services/cloudinary.service.js";
import { notifyBillCreated } from "../services/notification.service.js";
import mongoose from "mongoose";
import multer from "multer";
import path from "path";
import fs from "fs/promises";

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, './public/temp');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

export const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files (JPEG, PNG) and PDF are allowed'));
    }
});

// Create bill with splits
export const createBill = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const {
        title,
        vendor,
        totalAmount,
        dueDate,
        category,
        notes,
        isRecurring,
        recurrenceRule,
        splitMethod,
        participants
    } = req.body;

    // Verify flat exists and user is a member
    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Create bill
    const bill = await Bill.create({
        flatId,
        title,
        vendor,
        totalAmount,
        dueDate,
        createdBy: req.user._id,
        category: category || 'other',
        notes,
        isRecurring: isRecurring || false,
        recurrenceRule: isRecurring ? recurrenceRule : undefined
    });

    // Create bill splits
    const billSplits = [];
    
    if (splitMethod === 'equal') {
        const amountPerPerson = totalAmount / participants.length;
        
        for (const participant of participants) {
            const split = await BillSplit.create({
                billId: bill._id,
                userId: participant.userId,
                amount: Math.round(amountPerPerson * 100) / 100,
                status: 'owed'
            });
            billSplits.push(split);
        }
    } else {
        // Custom split
        let totalAllocated = 0;
        
        for (const participant of participants) {
            if (!participant.amount || participant.amount <= 0) {
                throw new ApiError(400, "Invalid participant amount for custom split");
            }
            
            totalAllocated += participant.amount;
            
            const split = await BillSplit.create({
                billId: bill._id,
                userId: participant.userId,
                amount: participant.amount,
                status: 'owed'
            });
            billSplits.push(split);
        }
        
        // Verify total matches
        if (Math.abs(totalAllocated - totalAmount) > 0.01) {
            throw new ApiError(400, "Custom split amounts must equal total amount");
        }
    }

    // Update bill status
    await bill.updateStatus();
    await bill.save();

    // Send notifications to all participants
    try {
        console.log('💬 Attempting to send bill notifications...');
        const participantIds = participants.map(p => p.userId);
        console.log('Participants to notify:', participantIds.length);
        await notifyBillCreated(bill, participantIds);
        console.log('✅ Bill notifications sent successfully');
    } catch (notifError) {
        console.error('❌ Failed to send bill notifications:', notifError);
        // Don't fail the request if notifications fail
    }

    // Populate and return
    const populatedBill = await Bill.findById(bill._id)
        .populate('createdBy', 'userName email')
        .populate('flatId', 'name');

    const splits = await BillSplit.find({ billId: bill._id })
        .populate('userId', 'userName email');

    return res.status(201).json(
        new ApiResponse(201, { bill: populatedBill, splits }, "Bill created successfully")
    );
});

// Get flat bills
export const getFlatBills = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { status, category, startDate, endDate } = req.query;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    const filter = { flatId };
    
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (startDate || endDate) {
        filter.dueDate = {};
        if (startDate) filter.dueDate.$gte = new Date(startDate);
        if (endDate) filter.dueDate.$lte = new Date(endDate);
    }

    const bills = await Bill.find(filter)
        .populate('createdBy', 'userName email')
        .sort({ dueDate: -1 });

    // Get splits for each bill
    const billsWithSplits = await Promise.all(
        bills.map(async (bill) => {
            const splits = await BillSplit.find({ billId: bill._id })
                .populate('userId', 'userName email');
            
            return {
                ...bill.toObject(),
                splits
            };
        })
    );

    return res.status(200).json(
        new ApiResponse(200, billsWithSplits, "Bills fetched successfully")
    );
});

// Get single bill
export const getBill = asyncHandler(async (req, res) => {
    const { billId } = req.params;

    const bill = await Bill.findById(billId)
        .populate('createdBy', 'userName email')
        .populate('flatId', 'name');

    if (!bill) {
        throw new ApiError(404, "Bill not found");
    }

    const flat = await Flat.findById(bill.flatId);
    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this bill");
    }

    const splits = await BillSplit.find({ billId: bill._id })
        .populate('userId', 'userName email');

    return res.status(200).json(
        new ApiResponse(200, { bill, splits }, "Bill fetched successfully")
    );
});

// Update bill
export const updateBill = asyncHandler(async (req, res) => {
    const { billId } = req.params;
    const updates = req.body;

    const bill = await Bill.findById(billId);
    if (!bill) {
        throw new ApiError(404, "Bill not found");
    }

    // Only creator can update
    if (bill.createdBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only bill creator can update the bill");
    }

    // Check if bill is paid
    if (bill.status === 'paid') {
        throw new ApiError(400, "Cannot update paid bills");
    }

    // Update allowed fields
    const allowedUpdates = ['title', 'vendor', 'dueDate', 'category', 'notes'];
    allowedUpdates.forEach(field => {
        if (updates[field] !== undefined) {
            bill[field] = updates[field];
        }
    });

    await bill.save();

    const populatedBill = await Bill.findById(bill._id)
        .populate('createdBy', 'userName email')
        .populate('flatId', 'name');

    return res.status(200).json(
        new ApiResponse(200, populatedBill, "Bill updated successfully")
    );
});

// Delete bill
export const deleteBill = asyncHandler(async (req, res) => {
    const { billId } = req.params;

    const bill = await Bill.findById(billId);
    if (!bill) {
        throw new ApiError(404, "Bill not found");
    }

    // Only creator can delete
    if (bill.createdBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only bill creator can delete the bill");
    }

    // Check if any payment has been made
    const paidSplits = await BillSplit.findOne({ 
        billId: bill._id, 
        status: { $in: ['paid', 'settled'] } 
    });

    if (paidSplits) {
        throw new ApiError(400, "Cannot delete bill with payments made");
    }

    // Delete bill splits first
    await BillSplit.deleteMany({ billId: bill._id });
    
    // Delete bill
    await Bill.findByIdAndDelete(billId);

    return res.status(200).json(
        new ApiResponse(200, {}, "Bill deleted successfully")
    );
});

// Scan bill (OCR)
export const scanBill = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, "Bill image is required");
    }

    try {
        let imageUrl = null;
        
        // Try to upload to Cloudinary if configured
        try {
            if (process.env.CLOUDINARY_CLOUD_NAME && 
                process.env.CLOUDINARY_API_KEY && 
                process.env.CLOUDINARY_API_SECRET) {
                imageUrl = await uploadBillImage(req.file.path);
            }
        } catch (cloudinaryError) {
            console.error('Cloudinary upload failed:', cloudinaryError.message);
        }

        // Process image with OCR
        const ocrResult = await processBillImage(req.file.path);

        // Cleanup uploaded file
        try {
            await fs.unlink(req.file.path);
        } catch (err) {
            // Ignore cleanup errors
        }

        if (!ocrResult.success) {
            throw new ApiError(400, ocrResult.error || 'OCR processing failed');
        }

        // Return structured response
        return res.status(200).json(
            new ApiResponse(200, {
                imageUrl: imageUrl || null,
                confidence: ocrResult.confidence,
                vendor: ocrResult.parsedData?.vendor,
                date: ocrResult.parsedData?.date,
                invoiceNumber: ocrResult.parsedData?.invoiceNumber,
                subtotal: ocrResult.parsedData?.subtotal,
                tax: ocrResult.parsedData?.tax,
                total: ocrResult.parsedData?.total,
                items: ocrResult.parsedData?.items || [],
                category: ocrResult.parsedData?.category || 'other',
                rawText: ocrResult.rawText
            }, "Bill scanned successfully")
        );
    } catch (error) {
        // Cleanup uploaded file on error
        try {
            await fs.unlink(req.file.path);
        } catch (err) {
            // Ignore cleanup errors
        }
        
        console.error('Bill scan failed:', error.message);
        throw new ApiError(500, `Bill scan failed: ${error.message}`);
    }
});

// Mark bill split as paid
export const markBillPaid = asyncHandler(async (req, res) => {
    const { billId } = req.params;
    const { userId } = req.body; // Which user's split to mark as paid

    const bill = await Bill.findById(billId);
    if (!bill) {
        throw new ApiError(404, "Bill not found");
    }

    const targetUserId = userId || req.user._id;

    // Find the bill split
    const billSplit = await BillSplit.findOne({
        billId: bill._id,
        userId: targetUserId
    });

    if (!billSplit) {
        throw new ApiError(404, "Bill split not found for this user");
    }

    if (billSplit.status === 'paid' || billSplit.status === 'settled') {
        throw new ApiError(400, "Bill split already paid");
    }

    // Mark as paid
    await billSplit.markPaid();

    return res.status(200).json(
        new ApiResponse(200, billSplit, "Bill marked as paid successfully")
    );
});

// Get user dues
export const getUserDues = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const requestUserId = userId || req.user._id;

    const dues = await BillSplit.find({
        userId: requestUserId,
        status: 'owed'
    })
    .populate({
        path: 'billId',
        populate: {
            path: 'flatId',
            select: 'name'
        }
    })
    .sort({ 'billId.dueDate': 1 });

    const totalDue = dues.reduce((sum, due) => sum + due.amount, 0);

    return res.status(200).json(
        new ApiResponse(200, { dues, totalDue }, "User dues fetched successfully")
    );
});
