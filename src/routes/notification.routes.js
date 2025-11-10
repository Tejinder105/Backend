import { Router } from 'express';
import {
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    deleteReadNotifications,
    getUnreadCount
} from '../controllers/notification.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

// Protect all routes
router.use(verifyJWT);

// Get notifications
router.get('/users/:userId', getUserNotifications);
router.get('/', getUserNotifications); // Current user notifications

// Unread count
router.get('/unread/count', getUnreadCount);

// Mark as read
router.put('/:notificationId/read', markNotificationAsRead);
router.put('/read/all', markAllNotificationsAsRead);

// Delete notifications
router.delete('/:notificationId', deleteNotification);
router.delete('/read/all', deleteReadNotifications);

export default router;
