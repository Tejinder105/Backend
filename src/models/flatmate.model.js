import mongoose, { Schema } from "mongoose";

const flatmateSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },
        role: {
            type: String,
            enum: ['lead_tenant', 'co_tenant', 'temporary_occupant'],
            default: 'co_tenant'
        },
        monthlyContribution: {
            type: Number,
            required: true,
            min: 0
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active'
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        leftAt: {
            type: Date,
            default: null
        },
        contactNumber: {
            type: String,
            trim: true
        },
        emergencyContact: {
            name: {
                type: String,
                trim: true
            },
            phone: {
                type: String,
                trim: true
            },
            relationship: {
                type: String,
                trim: true
            }
        },
        preferences: {
            notifications: {
                type: Boolean,
                default: true
            },
            reminderFrequency: {
                type: String,
                enum: ['daily', 'weekly', 'monthly'],
                default: 'weekly'
            }
        }
    },
    {
        timestamps: true
    }
);

// Index for efficient queries
flatmateSchema.index({ userId: 1 });
flatmateSchema.index({ email: 1 });
flatmateSchema.index({ status: 1 });

export const Flatmate = mongoose.model("Flatmate", flatmateSchema);