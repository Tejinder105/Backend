/**
 * Migration Script: Add flatId to Expense Model
 * 
 * This script migrates existing expenses to include flatId reference
 * Run this BEFORE making flatId required in the schema
 * 
 * Usage: node src/scripts/migrate_expenses_add_flatId.js
 */

import mongoose from 'mongoose';
import { Expense } from '../models/expense.model.js';
import { Flat } from '../models/flat.model.js';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function migrateExpenses() {
    try {
        console.log('🔄 Starting expense migration...');
        console.log('📡 Connecting to database...');
        
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to database');

        // Get all expenses without flatId
        const expenses = await Expense.find({
            $or: [
                { flatId: { $exists: false } },
                { flatId: null }
            ]
        });

        console.log(`📊 Found ${expenses.length} expenses to migrate`);

        if (expenses.length === 0) {
            console.log('✅ No expenses need migration');
            return;
        }

        let migrated = 0;
        let failed = 0;
        const orphaned = [];

        for (const expense of expenses) {
            try {
                // Find flat through creator or participants
                const userIds = [
                    expense.createdBy,
                    ...expense.participants.map(p => p.userId)
                ];

                const flat = await Flat.findOne({
                    $or: [
                        { admin: { $in: userIds } },
                        { 'members.userId': { $in: userIds } }
                    ],
                    status: 'active'
                }).sort({ createdAt: -1 }); // Get most recent flat

                if (flat) {
                    expense.flatId = flat._id;
                    await expense.save();
                    migrated++;
                    console.log(`✅ Migrated expense ${expense._id} to flat ${flat.name}`);
                } else {
                    // Mark as orphaned
                    orphaned.push({
                        expenseId: expense._id,
                        title: expense.title,
                        createdBy: expense.createdBy,
                        amount: expense.totalAmount
                    });
                    failed++;
                    console.warn(`⚠️  No flat found for expense ${expense._id} (${expense.title})`);
                }
            } catch (error) {
                console.error(`❌ Error migrating expense ${expense._id}:`, error.message);
                failed++;
            }
        }

        console.log('\n📊 Migration Summary:');
        console.log(`✅ Successfully migrated: ${migrated}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`⚠️  Orphaned expenses: ${orphaned.length}`);

        if (orphaned.length > 0) {
            console.log('\n⚠️  Orphaned Expenses (no flat found):');
            orphaned.forEach(exp => {
                console.log(`  - ${exp.title} (ID: ${exp.expenseId}, Amount: ${exp.amount})`);
            });
            console.log('\n💡 Action needed:');
            console.log('   1. Manually assign these expenses to flats, OR');
            console.log('   2. Delete them if they are invalid, OR');
            console.log('   3. Keep them with flatId=null (not recommended)');
        }

        console.log('\n✅ Migration completed');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await mongoose.disconnect();
        console.log('📡 Disconnected from database');
    }
}

// Run migration
if (import.meta.url === `file://${process.argv[1]}`) {
    migrateExpenses()
        .then(() => {
            console.log('\n🎉 Migration script finished successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Migration script failed:', error);
            process.exit(1);
        });
}

export default migrateExpenses;
