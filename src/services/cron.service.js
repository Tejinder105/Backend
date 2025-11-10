import cron from 'node-cron';
import { Bill } from '../models/bill.model.js';
import { BillSplit } from '../models/billSplit.model.js';
import { notifyBillDueSoon, notifyBillOverdue } from '../services/notification.service.js';

/**
 * Check for bills due soon and send notifications
 * Runs daily at 9 AM
 */
export const checkDueBills = cron.schedule('0 9 * * *', async () => {
    try {
        console.log('Running due bills check...');
        
        const now = new Date();
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

        // Find bills due within 3 days
        const upcomingBills = await Bill.find({
            dueDate: {
                $gte: now,
                $lte: threeDaysFromNow
            },
            status: { $in: ['pending', 'partial'] }
        });

        console.log(`Found ${upcomingBills.length} bills due soon`);

        // Send notifications for each bill's unpaid splits
        for (const bill of upcomingBills) {
            const unpaidSplits = await BillSplit.find({
                billId: bill._id,
                status: 'owed'
            });

            for (const split of unpaidSplits) {
                await notifyBillDueSoon(split, bill);
            }
        }

        console.log('Due bills check completed');
    } catch (error) {
        console.error('Error in due bills check:', error);
    }
}, {
    scheduled: false, // Don't start automatically
    timezone: "Asia/Kolkata"
});

/**
 * Check for overdue bills and send notifications
 * Runs daily at 10 AM
 */
export const checkOverdueBills = cron.schedule('0 10 * * *', async () => {
    try {
        console.log('Running overdue bills check...');
        
        const now = new Date();

        // Find overdue bills
        const overdueBills = await Bill.find({
            dueDate: { $lt: now },
            status: { $in: ['pending', 'partial', 'overdue'] }
        });

        console.log(`Found ${overdueBills.length} overdue bills`);

        // Update bill status and send notifications
        for (const bill of overdueBills) {
            if (bill.status !== 'overdue') {
                bill.status = 'overdue';
                await bill.save();
            }

            const unpaidSplits = await BillSplit.find({
                billId: bill._id,
                status: 'owed'
            });

            for (const split of unpaidSplits) {
                await notifyBillOverdue(split, bill);
            }
        }

        console.log('Overdue bills check completed');
    } catch (error) {
        console.error('Error in overdue bills check:', error);
    }
}, {
    scheduled: false,
    timezone: "Asia/Kolkata"
});

/**
 * Start all cron jobs
 */
export const startCronJobs = () => {
    checkDueBills.start();
    checkOverdueBills.start();
    console.log('✅ Cron jobs started');
};

/**
 * Stop all cron jobs
 */
export const stopCronJobs = () => {
    checkDueBills.stop();
    checkOverdueBills.stop();
    console.log('❌ Cron jobs stopped');
};

export default {
    checkDueBills,
    checkOverdueBills,
    startCronJobs,
    stopCronJobs
};
