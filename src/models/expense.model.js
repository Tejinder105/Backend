import mongoose, { Schema } from "mongoose";

const expenseSchema = new Schema(
    {
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            required: true,
            trim: true
        },
        totalAmount: {
            type: Number,
            required: true,
            min: 0
        },
        category: {
            type: String,
            enum: ['groceries', 'utilities', 'internet', 'cleaning', 'maintenance', 'furniture', 'other'],
            required: true
        },
        splitMethod: {
            type: String,
            enum: ['equal', 'custom'],
            default: 'equal'
        },
        participants: [{
            userId: {
                type: Schema.Types.ObjectId,
                ref: "User",
                required: true
            },
            name: {
                type: String,
                required: true
            },
            amount: {
                type: Number,
                required: true,
                min: 0
            },
            isPaid: {
                type: Boolean,
                default: false
            },
            paidAt: {
                type: Date,
                default: null
            }
        }],
        status: {
            type: String,
            enum: ['active', 'settled', 'cancelled'],
            default: 'active'
        },
        settledAt: {
            type: Date,
            default: null
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

expenseSchema.index({ createdBy: 1, status: 1 });
expenseSchema.index({ "participants.userId": 1 });
expenseSchema.index({ category: 1 });

export const Expense = mongoose.model("Expense", expenseSchema);