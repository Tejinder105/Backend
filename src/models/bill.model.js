import mongoose, { Schema } from "mongoose";

const billSchema = new Schema(
    {
        flatId: {
            type: Schema.Types.ObjectId,
            ref: "Flat",
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200
        },
        vendor: {
            type: String,
            trim: true,
            maxlength: 100
        },
        totalAmount: {
            type: Number,
            required: true,
            min: 0
        },
        dueDate: {
            type: Date,
            required: true
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        isRecurring: {
            type: Boolean,
            default: false
        },
        recurrenceRule: {
            frequency: {
                type: String,
                enum: ['daily', 'weekly', 'monthly', 'yearly'],
                default: 'monthly'
            },
            interval: {
                type: Number,
                default: 1,
                min: 1
            },
            endDate: {
                type: Date,
                default: null
            }
        },
        notes: {
            type: String,
            trim: true,
            maxlength: 1000
        },
        imageUrl: {
            type: String,
            default: null
        },
        category: {
            type: String,
            enum: ['rent', 'utilities', 'internet', 'groceries', 'cleaning', 'maintenance', 'furniture', 'other'],
            default: 'other'
        },
        status: {
            type: String,
            enum: ['pending', 'partial', 'paid', 'overdue'],
            default: 'pending'
        }
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
billSchema.index({ flatId: 1, status: 1 });
billSchema.index({ dueDate: 1 });
billSchema.index({ createdBy: 1 });

// Virtual to check if bill is overdue
billSchema.virtual('isOverdue').get(function() {
    return this.status !== 'paid' && new Date() > this.dueDate;
});

// Method to update bill status based on splits
billSchema.methods.updateStatus = async function() {
    const BillSplit = mongoose.model('BillSplit');
    const splits = await BillSplit.find({ billId: this._id });
    
    if (splits.length === 0) {
        this.status = 'pending';
        return;
    }

    const allPaid = splits.every(split => split.status === 'paid' || split.status === 'settled');
    const nonePaid = splits.every(split => split.status === 'owed');
    
    if (allPaid) {
        this.status = 'paid';
    } else if (nonePaid) {
        this.status = new Date() > this.dueDate ? 'overdue' : 'pending';
    } else {
        this.status = 'partial';
    }
};

export const Bill = mongoose.model("Bill", billSchema);
