import mongoose, { Schema } from "mongoose";

const billSplitSchema = new Schema(
    {
        billId: {
            type: Schema.Types.ObjectId,
            ref: "Bill",
            required: true,
            index: true
        },
        flatId: {
            type: Schema.Types.ObjectId,
            ref: "Flat",
            required: true,
            index: true
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        status: {
            type: String,
            enum: ['owed', 'paid', 'settled'],
            default: 'owed'
        },
        paidAt: {
            type: Date,
            default: null
        },
        paymentId: {
            type: Schema.Types.ObjectId,
            ref: "Transaction",
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes for efficient queries
billSplitSchema.index({ billId: 1, userId: 1 }, { unique: true }); // Prevent duplicate splits
billSplitSchema.index({ userId: 1, status: 1 });
billSplitSchema.index({ userId: 1, flatId: 1, status: 1 }); // CRITICAL: For getUserDues queries
billSplitSchema.index({ billId: 1, status: 1 }); // Added for batch status checks
billSplitSchema.index({ status: 1, paidAt: -1 }); // Added for payment history queries

// Method to mark split as paid
billSplitSchema.methods.markPaid = async function(transactionId = null) {
    this.status = 'paid';
    this.paidAt = new Date();
    if (transactionId) {
        this.paymentId = transactionId;
    }
    await this.save();
    
    // Update the parent bill status
    const Bill = mongoose.model('Bill');
    const bill = await Bill.findById(this.billId);
    if (bill) {
        await bill.updateStatus();
        await bill.save();
    }
};

export const BillSplit = mongoose.model("BillSplit", billSplitSchema);
