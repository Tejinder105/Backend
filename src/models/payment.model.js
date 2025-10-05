import mongoose, { Schema } from "mongoose";

const paymentSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        recipient: {
            type: String,
            required: true,
            trim: true
        },
        dueDate: {
            type: Date,
            required: true
        },
        status: {
            type: String,
            enum: ['pending', 'paid', 'overdue'],
            default: 'pending'
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        },
        type: {
            type: String,
            enum: ['rent', 'utility', 'flatmate', 'other'],
            required: true
        },
        paymentMethod: {
            type: String,
            enum: ['card', 'bank', 'venmo', 'cash'],
            default: null
        },
        paidAt: {
            type: Date,
            default: null
        },
        transactionId: {
            type: String,
            default: null
        },
        processingFee: {
            type: Number,
            default: 0
        },
        notes: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: true
    }
);

// Index for efficient queries
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ dueDate: 1 });

export const Payment = mongoose.model("Payment", paymentSchema);