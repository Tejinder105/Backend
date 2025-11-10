import { Notification } from '../models/notification.model.js';

/**
 * Create notification for a single user
 * @param {Object} data - Notification data
 * @returns {Promise<Object>} - Created notification
 */
export const createNotification = async (data) => {
    try {
        console.log('📝 Creating notification:', {
            userId: data.userId,
            type: data.type,
            title: data.title
        });
        const notification = await Notification.createNotification(data);
        console.log('✅ Notification created successfully:', notification._id);
        return notification;
    } catch (error) {
        console.error('❌ Failed to create notification:', error);
        throw error;
    }
};

/**
 * Create notifications for multiple users
 * @param {Array} userIds - Array of user IDs
 * @param {Object} data - Notification data
 * @returns {Promise<Array>} - Created notifications
 */
export const createBulkNotifications = async (userIds, data) => {
    try {
        console.log(`📝 Creating ${userIds.length} bulk notifications:`, {
            type: data.type,
            title: data.title
        });
        const notifications = await Notification.createBulkNotifications(userIds, data);
        console.log(`✅ Created ${notifications.length} bulk notifications successfully`);
        return notifications;
    } catch (error) {
        console.error('❌ Failed to create bulk notifications:', error);
        throw error;
    }
};

/**
 * Notify flat members about new bill
 * @param {Object} bill - Bill object
 * @param {Array} memberIds - Array of member user IDs
 */
export const notifyBillCreated = async (bill, memberIds) => {
    if (!memberIds || memberIds.length === 0) {
        console.log('⚠️ No members to notify for bill');
        return;
    }

    // Filter out the bill creator
    const creatorId = bill.createdBy?._id 
        ? bill.createdBy._id.toString() 
        : bill.createdBy.toString();
    
    const membersToNotify = memberIds.filter(memberId => {
        const memberIdStr = memberId?._id 
            ? memberId._id.toString() 
            : memberId.toString();
        return memberIdStr !== creatorId;
    });

    if (membersToNotify.length === 0) {
        console.log('⚠️ No members to notify (creator is the only participant)');
        return;
    }

    console.log(`📧 Sending bill notifications to ${membersToNotify.length} members (excluding creator)`);
    
    const title = 'New Bill Created';
    const message = `A new bill "${bill.title}" of ₹${bill.totalAmount} has been created. Due date: ${new Date(bill.dueDate).toLocaleDateString()}`;
    
    try {
        await createBulkNotifications(membersToNotify, {
            flatId: bill.flatId,
            type: 'bill_created',
            title,
            message,
            payload: {
                billId: bill._id,
                title: bill.title,
                amount: bill.totalAmount,
                dueDate: bill.dueDate
            },
            priority: 'medium'
        });
        console.log('✅ Bill bulk notifications created successfully');
    } catch (error) {
        console.error('❌ Failed to create bill notifications:', error);
        throw error;
    }
};

/**
 * Notify participants about new expense
 * @param {Object} expense - Expense object
 * @param {String} creatorName - Name of expense creator
 */
export const notifyExpenseCreated = async (expense, creatorName) => {
    // Get creator ID (handle both populated and non-populated cases)
    const creatorId = expense.createdBy?._id 
        ? expense.createdBy._id.toString() 
        : expense.createdBy.toString();
    
    // Filter out the creator from participants
    const participantsToNotify = expense.participants.filter(p => {
        const participantId = p.userId?._id 
            ? p.userId._id.toString() 
            : p.userId.toString();
        return participantId !== creatorId;
    });
    
    if (participantsToNotify.length === 0) {
        console.log('⚠️ No participants to notify (creator is the only participant)');
        return;
    }

    console.log(`📧 Sending expense notifications to ${participantsToNotify.length} participants`);
    
    // Send individual notifications with correct amounts for each participant
    const notificationPromises = participantsToNotify.map(participant => {
        const participantUserId = participant.userId?._id || participant.userId;
        const title = 'New Expense Split';
        const message = `${creatorName} added a new expense "${expense.title}" of ₹${expense.totalAmount}. Your share: ₹${participant.amount}`;
        
        console.log(`  → Notifying participant: ${participant.name} (₹${participant.amount})`);
        
        return createNotification({
            userId: participantUserId,
            flatId: expense.flatId || null,
            type: 'expense_created',
            title,
            message,
            payload: {
                expenseId: expense._id,
                title: expense.title,
                totalAmount: expense.totalAmount,
                amount: participant.amount,
                category: expense.category,
                createdBy: creatorId,
                createdByName: creatorName
            },
            priority: 'medium'
        });
    });
    
    await Promise.all(notificationPromises);
    console.log('✅ All expense notifications sent successfully');
};

/**
 * Notify user about bill due soon
 * @param {Object} billSplit - BillSplit object
 * @param {Object} bill - Bill object
 */
export const notifyBillDueSoon = async (billSplit, bill) => {
    const daysUntilDue = Math.ceil((new Date(bill.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    const title = 'Bill Due Soon';
    const message = `Bill "${bill.title}" is due in ${daysUntilDue} days. Amount: ${billSplit.amount}`;
    
    await createNotification({
        userId: billSplit.userId,
        flatId: bill.flatId,
        type: 'bill_due',
        title,
        message,
        payload: {
            billId: bill._id,
            billSplitId: billSplit._id,
            amount: billSplit.amount,
            dueDate: bill.dueDate,
            daysUntilDue
        },
        priority: 'high'
    });
};

/**
 * Notify user about overdue bill
 * @param {Object} billSplit - BillSplit object
 * @param {Object} bill - Bill object
 */
export const notifyBillOverdue = async (billSplit, bill) => {
    const daysOverdue = Math.ceil((new Date() - new Date(bill.dueDate)) / (1000 * 60 * 60 * 24));
    const title = 'Bill Overdue';
    const message = `Bill "${bill.title}" is ${daysOverdue} days overdue. Please pay ${billSplit.amount} as soon as possible.`;
    
    await createNotification({
        userId: billSplit.userId,
        flatId: bill.flatId,
        type: 'bill_overdue',
        title,
        message,
        payload: {
            billId: bill._id,
            billSplitId: billSplit._id,
            amount: billSplit.amount,
            dueDate: bill.dueDate,
            daysOverdue
        },
        priority: 'high'
    });
};

/**
 * Notify bill creator about payment received
 * @param {Object} billSplit - BillSplit object
 * @param {Object} bill - Bill object
 * @param {Object} user - User who paid
 */
export const notifyPaymentReceived = async (billSplit, bill, user) => {
    const title = 'Payment Received';
    const message = `${user.userName} has paid ${billSplit.amount} for bill "${bill.title}"`;
    
    await createNotification({
        userId: bill.createdBy,
        flatId: bill.flatId,
        type: 'payment_received',
        title,
        message,
        payload: {
            billId: bill._id,
            billSplitId: billSplit._id,
            amount: billSplit.amount,
            paidBy: user._id,
            paidByName: user.userName
        },
        priority: 'medium'
    });
};

/**
 * Notify flat members about new member joined
 * @param {Object} flat - Flat object
 * @param {Object} newMember - New member user object
 * @param {Array} memberIds - Array of existing member user IDs
 */
export const notifyMemberJoined = async (flat, newMember, memberIds) => {
    const title = 'New Member Joined';
    const message = `${newMember.userName} has joined the flat "${flat.name}"`;
    
    await createBulkNotifications(memberIds, {
        flatId: flat._id,
        type: 'member_joined',
        title,
        message,
        payload: {
            userId: newMember._id,
            userName: newMember.userName
        },
        priority: 'low'
    });
};

/**
 * Notify flat members about member left
 * @param {Object} flat - Flat object
 * @param {Object} leftMember - Member who left
 * @param {Array} memberIds - Array of remaining member user IDs
 */
export const notifyMemberLeft = async (flat, leftMember, memberIds) => {
    const title = 'Member Left';
    const message = `${leftMember.userName} has left the flat "${flat.name}"`;
    
    await createBulkNotifications(memberIds, {
        flatId: flat._id,
        type: 'member_left',
        title,
        message,
        payload: {
            userId: leftMember._id,
            userName: leftMember.userName
        },
        priority: 'low'
    });
};

/**
 * Notify flat members about budget alert
 * @param {Object} flat - Flat object
 * @param {Array} memberIds - Array of member user IDs
 * @param {number} spent - Amount spent
 * @param {number} budget - Budget amount
 */
export const notifyBudgetAlert = async (flat, memberIds, spent, budget) => {
    const percentage = ((spent / budget) * 100).toFixed(0);
    const title = 'Budget Alert';
    const message = `Your flat has used ${percentage}% of the monthly budget (${spent} / ${budget})`;
    
    await createBulkNotifications(memberIds, {
        flatId: flat._id,
        type: 'budget_alert',
        title,
        message,
        payload: {
            spent,
            budget,
            percentage
        },
        priority: percentage >= 90 ? 'high' : 'medium'
    });
};

export default {
    createNotification,
    createBulkNotifications,
    notifyBillCreated,
    notifyBillDueSoon,
    notifyBillOverdue,
    notifyPaymentReceived,
    notifyMemberJoined,
    notifyMemberLeft,
    notifyBudgetAlert
};
