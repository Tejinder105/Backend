import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        flatId: {
            type: Schema.Types.ObjectId,
            ref: "Flat",
            default: null
        },
        type: {
            type: String,
            enum: [
                'bill_created', 
                'bill_due', 
                'bill_overdue', 
                'payment_received', 
                'payment_reminder', 
                'expense_created',
                'member_joined', 
                'member_left', 
                'budget_alert', 
                'other'
            ],
            required: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200
        },
        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500
        },
        payload: {
            type: Schema.Types.Mixed,
            default: {}
        },
        read: {
            type: Boolean,
            default: false
        },
        readAt: {
            type: Date,
            default: null
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        }
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
notificationSchema.index({ userId: 1, read: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ flatId: 1 });

// Method to mark notification as read
notificationSchema.methods.markAsRead = async function() {
    this.read = true;
    this.readAt = new Date();
    await this.save();
};

// Static method to create notification
notificationSchema.statics.createNotification = async function(data) {
    return await this.create({
        userId: data.userId,
        flatId: data.flatId,
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload || {},
        priority: data.priority || 'medium'
    });
};

// Static method to create notifications for multiple users
notificationSchema.statics.createBulkNotifications = async function(userIds, data) {
    const notifications = userIds.map(userId => ({
        userId,
        flatId: data.flatId,
        type: data.type,
        title: data.title,
        message: data.message,
        payload: data.payload || {},
        priority: data.priority || 'medium'
    }));

    return await this.insertMany(notifications);
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = async function(userId) {
    return await this.countDocuments({ userId, read: false });
};

export const Notification = mongoose.model("Notification", notificationSchema);
