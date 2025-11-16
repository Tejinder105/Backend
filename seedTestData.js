/*
seedTestData.js (FIXED VERSION)
- Correct import paths for your folder structure
- joinCode added manually to avoid validation error
- ES module compatible
- Fully runnable

USAGE:
  1) Place this file in your Backend/ folder (same level as src/)
  2) Install: npm install dayjs
  3) Ensure .env has MONGO_URI
  4) Run: node seedTestData.js
  5) Cleanup: node seedTestData.js --cleanup
*/

import 'dotenv/config';
import mongoose from 'mongoose';
import dayjs from 'dayjs';

// ------------------ IMPORT MODELS ------------------
// Adjusted for your folder structure (/src/models/*.model.js)
import './src/models/user.model.js';
import './src/models/flat.model.js';
import './src/models/bill.model.js';
import './src/models/billSplit.model.js';
import './src/models/expense.model.js';
import './src/models/budgetSnapshot.model.js';
import './src/models/payment.model.js';
import './src/models/transaction.model.js';
import './src/models/notification.model.js';
// ----------------------------------------------------

const User = mongoose.model('User');
const Flat = mongoose.model('Flat');
const Bill = mongoose.model('Bill');
const BillSplit = mongoose.model('BillSplit');
const Expense = mongoose.model('Expense');
const BudgetSnapshot = mongoose.model('BudgetSnapshot');
const Payment = mongoose.model('Payment');
const Transaction = mongoose.model('Transaction');
const Notification = mongoose.model('Notification');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart_rent_test';
const TEST_TAG = 'TEST_DATA_SEED_v1';

// ------------------ USERS ------------------
const USERS = [
  { userName: 'tejinderpal', fullName: 'Tejinderpal', email: 'tejinderpal@test.com', phone: '9999000001', password: 'password123' },
  { userName: 'happy', fullName: 'Happy', email: 'happy@test.com', phone: '9999000002', password: 'password123' },
  { userName: 'ishan', fullName: 'Ishan', email: 'ishan@test.com', phone: '9999000003', password: 'password123' },
  { userName: 'yuvraj', fullName: 'Yuvraj', email: 'yuvraj@test.com', phone: '9999000004', password: 'password123' },
  { userName: 'ramswarup', fullName: 'Ramswarup', email: 'ramswarup@test.com', phone: '9999000005', password: 'password123' }
];

// Provided values
const RENT = 30000;
const MONTHLY_BUDGET = 70000;

async function connect() {
  await mongoose.connect(MONGO_URI);
}

async function cleanup() {
  console.log('Removing test data...');
  await Notification.deleteMany({ message: { $regex: TEST_TAG } });
  await Transaction.deleteMany({ note: { $regex: TEST_TAG } });
  await Payment.deleteMany({ notes: { $regex: TEST_TAG } });
  await BudgetSnapshot.deleteMany({ notes: { $regex: TEST_TAG } });
  await Expense.deleteMany({ notes: { $regex: TEST_TAG } });
  await Bill.deleteMany({ notes: { $regex: TEST_TAG } });
  await Flat.deleteMany({ name: { $regex: TEST_TAG } });
  await User.deleteMany({ email: { $regex: '@test.local$' } });
  console.log('Cleanup complete!');
}

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  console.log('Seeding test data into', MONGO_URI);

  // ------------------ 1) USERS ------------------
  const createdUsers = [];
  for (const u of USERS) {
    let user = await User.findOne({ email: u.email });
    if (!user) user = await User.create(u);
    createdUsers.push(user);
  }
  console.log('Users ready:', createdUsers.map(u => u.userName).join(', '));

  // ------------------ 2) FLAT ------------------
  const adminUser = createdUsers[0];
  const flatName = `SmartRent_Test_${TEST_TAG}`;

  let flat = await Flat.findOne({ name: flatName });
  if (!flat) {
    flat = await Flat.create({
      name: flatName,
      joinCode: 'TEST' + Math.floor(Math.random() * 99999), // FIXED
      rent: RENT,
      currency: 'INR',
      monthlyBudget: MONTHLY_BUDGET,
      admin: adminUser._id,
      members: createdUsers.map((u, idx) => ({
        userId: u._id,
        role: idx === 0 ? 'admin' : 'co_tenant',
        monthlyContribution: Math.round(RENT / USERS.length),
        status: 'active'
      })),
      stats: { totalMembers: USERS.length, totalExpenses: 0, totalPayments: 0 }
    });
  }

  console.log('Flat ready:', flat.name, 'JoinCode:', flat.joinCode);

  const today = dayjs();
  const memberIds = flat.members.map(m => m.userId);

  const billsCreated = [];
  const expensesCreated = [];
  const transactionsCreated = [];

  // ------------------ 3) GENERATE 90 DAYS OF DATA ------------------
  for (let i = 0; i < 90; i++) {
    const day = today.subtract(i, 'day');

    // ---- Bills ----
    const isRentDay = day.date() === 1;
    const billCategories = ['rent', 'utilities', 'internet', 'groceries', 'cleaning', 'maintenance', 'furniture', 'other'];
    const numBills = isRentDay ? 1 : randBetween(0, 1);

    for (let b = 0; b < numBills; b++) {
      const category = isRentDay ? 'rent' : billCategories[randBetween(0, billCategories.length - 1)];
      const amount = category === 'rent' ? RENT : randBetween(200, 4000);

      const bill = await Bill.create({
        flatId: flat._id,
        title: `${category} bill ${TEST_TAG}`,
        vendor: 'autoVendor',
        totalAmount: amount,
        dueDate: day.add(3, 'day').toDate(),
        createdBy: adminUser._id,
        notes: TEST_TAG,
        category,
        status: 'pending'
      });

      // Splits
      const perMember = Math.round(amount / memberIds.length);
      for (const uid of memberIds) {
        await BillSplit.create({ billId: bill._id, userId: uid, amount: perMember, status: 'owed' });
      }

      billsCreated.push(bill);

      // Mark some splits paid
      const splits = await BillSplit.find({ billId: bill._id });
      for (const s of splits) {
        if (Math.random() < 0.6) {
          const txn = await Transaction.create({
            flatId: flat._id,
            type: 'payment',
            amount: s.amount,
            fromUserId: s.userId,
            toUserId: adminUser._id,
            note: TEST_TAG
          });
          s.status = 'paid';
          s.paidAt = day.toDate();
          s.paymentId = txn._id;
          await s.save();
          transactionsCreated.push(txn);
        }
      }

      await bill.updateStatus();
      await bill.save();
    }

    // ---- Expenses ----
    const expenseCategories = ['groceries', 'utilities', 'internet', 'cleaning', 'maintenance', 'furniture', 'other'];
    const numExpenses = randBetween(0, 2);

    for (let e = 0; e < numExpenses; e++) {
      const category = expenseCategories[randBetween(0, expenseCategories.length - 1)];
      const amount = randBetween(100, 3000);

      const participants = memberIds.map(uid => ({
        userId: uid,
        name: uid.toString(),
        amount: Math.round(amount / memberIds.length),
        isPaid: Math.random() < 0.5
      }));

      const expense = await Expense.create({
        flatId: flat._id,
        createdBy: adminUser._id,
        title: `Expense ${category} ${TEST_TAG}`,
        description: 'auto-generated',
        totalAmount: amount,
        category,
        splitMethod: 'equal',
        participants,
        notes: TEST_TAG
      });

      expensesCreated.push(expense);

      // expense payments
      for (const p of participants.filter(p => p.isPaid)) {
        const txn = await Transaction.create({
          flatId: flat._id,
          type: 'payment',
          amount: p.amount,
          fromUserId: p.userId,
          toUserId: adminUser._id,
          note: TEST_TAG
        });
        transactionsCreated.push(txn);
      }
    }
  }

  // ------------------ 4) BUDGET SNAPSHOTS ------------------
  for (let m = 0; m < 3; m++) {
    const month = today.subtract(m, 'month').format('YYYY-MM');
    const snap = await BudgetSnapshot.getOrCreate(flat._id, month, MONTHLY_BUDGET);
    snap.notes = TEST_TAG;
    snap.actualSpent = randBetween(30000, 90000);
    await snap.save();
  }

  // ------------------ 5) UPDATE FLAT STATS ------------------
  flat.stats.totalExpenses = await Expense.countDocuments({ flatId: flat._id });
  flat.stats.totalPayments = await Transaction.countDocuments({ flatId: flat._id });
  await flat.save();

  console.log('--- DONE ---');
  console.log('Bills:', billsCreated.length);
  console.log('Expenses:', expensesCreated.length);
  console.log('Transactions:', transactionsCreated.length);
  console.log('Snapshots: 3');
}

(async () => {
  try {
    await connect();

    if (process.argv.includes('--cleanup')) {
      await cleanup();
      process.exit(0);
    }

    await seed();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
