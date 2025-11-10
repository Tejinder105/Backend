import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { Notification } from "../models/notification.model.js";

// Get user notifications
export const getUserNotifications = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { read, type, limit = 50, page = 1 } = req.query;
    
    const requestUserId = userId || req.user._id;

    // Build filter
    const filter = { userId: requestUserId };
    
    if (read !== undefined) {
        filter.read = read === 'true';
    }
    
    if (type) {
        filter.type = type;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notifications = await Notification.find(filter)
        .populate('flatId', 'name')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip);

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.getUnreadCount(requestUserId);

    return res.status(200).json(
        new ApiResponse(200, {
            notifications,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            },
            unreadCount
        }, "Notifications fetched successfully")
    );
});

// Mark notification as read
export const markNotificationAsRead = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);
    
    if (!notification) {
        throw new ApiError(404, "Notification not found");
    }

    // Verify ownership
    if (notification.userId.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You can only mark your own notifications as read");
    }

    if (!notification.read) {
        await notification.markAsRead();
    }

    return res.status(200).json(
        new ApiResponse(200, notification, "Notification marked as read")
    );
});

// Mark all notifications as read
export const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const result = await Notification.updateMany(
        { userId, read: false },
        { $set: { read: true, readAt: new Date() } }
    );

    return res.status(200).json(
        new ApiResponse(200, {
            modifiedCount: result.modifiedCount
        }, "All notifications marked as read")
    );
});

// Delete notification
export const deleteNotification = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;

    const notification = await Notification.findById(notificationId);
    
    if (!notification) {
        throw new ApiError(404, "Notification not found");
    }

    // Verify ownership
    if (notification.userId.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You can only delete your own notifications");
    }

    await Notification.findByIdAndDelete(notificationId);

    return res.status(200).json(
        new ApiResponse(200, {}, "Notification deleted successfully")
    );
});

// Delete all read notifications
export const deleteReadNotifications = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const result = await Notification.deleteMany({
        userId,
        read: true
    });

    return res.status(200).json(
        new ApiResponse(200, {
            deletedCount: result.deletedCount
        }, "Read notifications deleted successfully")
    );
});

// Get unread count
export const getUnreadCount = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const count = await Notification.getUnreadCount(userId);

    return res.status(200).json(
        new ApiResponse(200, { unreadCount: count }, "Unread count fetched successfully")
    );
});
