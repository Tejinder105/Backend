import mongoose, { Schema } from "mongoose";

const transactionSchema = new Schema(
    {
        flatId: {
            type: Schema.Types.ObjectId,
            ref: "Flat",
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: ['payment', 'refund', 'adjustment'],
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        fromUserId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        toUserId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        billId: {
            type: Schema.Types.ObjectId,
            ref: "Bill",
            default: null
        },
        note: {
            type: String,
            trim: true,
            maxlength: 500
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'cancelled'],
            default: 'completed'
        },
        paymentMethod: {
            type: String,
            enum: ['cash', 'card', 'bank_transfer', 'upi', 'other'],
            default: 'other'
        },
        transactionReference: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
transactionSchema.index({ flatId: 1, type: 1 });
transactionSchema.index({ fromUserId: 1 });
transactionSchema.index({ toUserId: 1 });
transactionSchema.index({ billId: 1 });
transactionSchema.index({ createdAt: -1 });

// Static method to create payment transaction
transactionSchema.statics.createPayment = async function(data) {
    const transaction = await this.create({
        flatId: data.flatId,
        type: 'payment',
        amount: data.amount,
        fromUserId: data.fromUserId,
        toUserId: data.toUserId,
        billId: data.billId,
        note: data.note,
        paymentMethod: data.paymentMethod,
        transactionReference: data.transactionReference,
        status: 'completed'
    });

    return transaction;
};

// Method to get transaction summary
transactionSchema.statics.getSummary = async function(flatId, userId = null) {
    const matchStage = userId 
        ? { flatId: new mongoose.Types.ObjectId(flatId), $or: [{ fromUserId: new mongoose.Types.ObjectId(userId) }, { toUserId: new mongoose.Types.ObjectId(userId) }] }
        : { flatId: new mongoose.Types.ObjectId(flatId) };

    const summary = await this.aggregate([
        { $match: matchStage },
        {
            $group: {
                _id: '$type',
                totalAmount: { $sum: '$amount' },
                count: { $sum: 1 }
            }
        }
    ]);

    return summary;
};

export const Transaction = mongoose.model("Transaction", transactionSchema);
