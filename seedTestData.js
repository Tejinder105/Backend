/**
 * Enhanced Seed Script - 6 Months Historical Data with Realistic Patterns
 * Generates meaningful spending patterns for ML forecasting
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);

/* -------------------- IMPORT MODELS -------------------- */
import './src/models/user.model.js';
import './src/models/flat.model.js';
import './src/models/bill.model.js';
import './src/models/billSplit.model.js';
import './src/models/expense.model.js';
import './src/models/budgetSnapshot.model.js';
import './src/models/transaction.model.js';
import './src/models/notification.model.js';

const User = mongoose.model('User');
const Flat = mongoose.model('Flat');
const Bill = mongoose.model('Bill');
const BillSplit = mongoose.model('BillSplit');
const Expense = mongoose.model('Expense');
const BudgetSnapshot = mongoose.model('BudgetSnapshot');
const Transaction = mongoose.model('Transaction');
const Notification = mongoose.model('Notification');

/* -------------------- CONFIG -------------------- */
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/smart_rent_test';
const TEST_TAG = 'SEED_V3';
const RENT = 35000;
const MONTHLY_BUDGET = 80000;
const NUM_MONTHS = 6;

// Realistic expense patterns per category with seasonal variations
const EXPENSE_PATTERNS = {
  groceries: {
    baseAmount: 12000,
    frequency: 8, // times per month
    variance: 0.25,
    vendors: ['Big Bazaar', 'DMart', 'More Supermarket', 'Local Grocery Store'],
    seasonal: { 6: 1.15, 7: 1.1, 11: 1.2, 12: 1.25 } // Festival months
  },
  utilities: {
    baseAmount: 4500,
    frequency: 3,
    variance: 0.3,
    vendors: ['Electricity Board', 'Water Department', 'Gas Cylinder'],
    seasonal: { 5: 1.4, 6: 1.5, 12: 1.3 } // Summer/Winter higher
  },
  internet: {
    baseAmount: 1200,
    frequency: 1,
    variance: 0.05,
    vendors: ['Jio Fiber', 'Airtel', 'ACT Broadband'],
    seasonal: {}
  },
  cleaning: {
    baseAmount: 1800,
    frequency: 4,
    variance: 0.2,
    vendors: ['Cleaning Supplies Store', 'Online Mart', 'Local Shop'],
    seasonal: { 10: 1.2, 3: 1.15 } // Festival cleaning
  },
  maintenance: {
    baseAmount: 2500,
    frequency: 2,
    variance: 0.4,
    vendors: ['Hardware Store', 'Plumber', 'Electrician', 'Carpenter'],
    seasonal: { 7: 1.3, 8: 1.3 } // Monsoon repairs
  },
  furniture: {
    baseAmount: 3000,
    frequency: 1,
    variance: 0.6,
    vendors: ['IKEA', 'Furniture Store', 'Online Shopping', 'Local Carpenter'],
    seasonal: { 1: 1.3, 10: 1.2 } // New year, Diwali
  },
  other: {
    baseAmount: 5000,
    frequency: 8,
    variance: 0.5,
    vendors: ['Swiggy', 'Zomato', 'Restaurant', 'Movie Theater', 'Uber', 'Ola', 'Pharmacy'],
    seasonal: { 12: 1.4, 1: 1.3, 4: 1.2 } // Holidays, entertainment, transport, health combined
  }
};

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[rand(0, arr.length - 1)];
}

async function connect() {
  console.log('🔌 Connecting to MongoDB:', MONGO_URI);
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected successfully\n');
}

async function cleanup() {
  console.log('🗑️  Cleaning up old test data...');
  await Notification.deleteMany({ message: { $regex: TEST_TAG } });
  await Transaction.deleteMany({ note: { $regex: TEST_TAG } });
  await Expense.deleteMany({ notes: { $regex: TEST_TAG } });
  await BudgetSnapshot.deleteMany({ notes: { $regex: TEST_TAG } });
  await BillSplit.deleteMany({ note: { $regex: TEST_TAG } });
  await Bill.deleteMany({ notes: { $regex: TEST_TAG } });
  await Flat.deleteMany({ name: { $regex: TEST_TAG } });
  await User.deleteMany({ email: { $regex: '@gmail.com$' } });
  console.log('✅ Cleanup complete\n');
}

async function seed() {
  console.log('🌱 Starting enhanced seed process...\n');

  // Create realistic users
  const USERS = [
    { userName: 'Tejinderpal', email: 'tejinderpal@gmail.com', phone: '9876543210', password: 'test123' },
    { userName: 'Happy', email: 'happy@gmail.com', phone: '9876543211', password: 'test123' },
    { userName: 'Ishan', email: 'ishan@gmail.com', phone: '9876543212', password: 'test123' },
    { userName: 'Yuvraj', email: 'yuvraj@gmail.com', phone: '9876543213', password: 'test123' },
    { userName: 'Ramswarup', email: 'ramswarup@gmail.com', phone: '9876543214', password: 'test123' }
  ];

  const users = [];
  for (const u of USERS) {
    let user = await User.findOne({ email: u.email });
    if (!user) {
      user = await User.create({ ...u, notes: TEST_TAG });
    }
    users.push(user);
    console.log(`✔️  User created: ${user.userName}`);
  }

  const adminUser = users[0];
  console.log();

  // Create flat
  let flat = await Flat.findOne({ name: `Sunshine Apartments ${TEST_TAG}` });
  if (!flat) {
    flat = await Flat.create({
      name: `Sunshine Apartments ${TEST_TAG}`,
      joinCode: 'JOIN' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      rent: RENT,
      currency: 'INR',
      monthlyBudget: MONTHLY_BUDGET,
      admin: adminUser._id,
      members: users.map((u, i) => ({
        userId: u._id,
        role: i === 0 ? 'admin' : 'co_tenant',
        monthlyContribution: Math.round(RENT / users.length),
        status: 'active'
      })),
      notes: TEST_TAG
    });
  }
  console.log(`🏢 Flat created: ${flat.name}\n`);

  const today = dayjs().utc();
  const allBills = [];
  const allExpenses = [];
  const allTransactions = [];

  // Generate 6 months of data
  for (let monthOffset = NUM_MONTHS - 1; monthOffset >= 0; monthOffset--) {
    const monthStart = today.subtract(monthOffset, 'month').startOf('month');
    const monthEnd = monthStart.endOf('month');
    const monthKey = monthStart.format('YYYY-MM');
    const monthNum = monthStart.month() + 1;

    console.log(`📅 Generating data for ${monthStart.format('MMMM YYYY')}...`);

    // 1. Create monthly rent bill (1st of month)
    const rentBill = await Bill.create({
      flatId: flat._id,
      title: `Monthly Rent - ${monthStart.format('MMMM YYYY')}`,
      vendor: 'Property Owner',
      totalAmount: RENT,
      dueDate: monthStart.add(3, 'day').toDate(),
      createdBy: adminUser._id,
      category: 'rent',
      status: 'paid',
      notes: TEST_TAG
    });
    allBills.push(rentBill);

    // Create bill splits and transactions for rent
    const rentPerPerson = Math.round(RENT / users.length);
    for (const user of users) {
      const split = await BillSplit.create({
        billId: rentBill._id,
        flatId: flat._id,
        userId: user._id,
        amount: rentPerPerson,
        status: 'paid',
        paidAt: monthStart.add(rand(1, 5), 'day').toDate(),
        note: `Rent split ${TEST_TAG}`
      });

      const txn = await Transaction.create({
        flatId: flat._id,
        type: 'payment',
        amount: rentPerPerson,
        fromUserId: user._id,
        toUserId: adminUser._id,
        billId: rentBill._id,
        note: `Rent payment ${TEST_TAG}`,
        paymentMethod: 'bank_transfer',
        status: 'completed',
        createdAt: split.paidAt
      });
      allTransactions.push(txn);
    }

    // 2. Generate category-based expenses throughout the month
    for (const [category, pattern] of Object.entries(EXPENSE_PATTERNS)) {
      const seasonalMultiplier = pattern.seasonal[monthNum] || 1.0;
      const monthlyTarget = pattern.baseAmount * seasonalMultiplier;
      
      for (let i = 0; i < pattern.frequency; i++) {
        const dayOfMonth = rand(1, monthEnd.date());
        const expenseDate = monthStart.add(dayOfMonth, 'day');
        
        // Skip future dates
        if (expenseDate.isAfter(today)) continue;

        // Calculate amount with variance
        const baseAmount = monthlyTarget / pattern.frequency;
        const variance = baseAmount * pattern.variance;
        const amount = Math.round(baseAmount + (Math.random() * 2 - 1) * variance);

        const paidBy = randomChoice(users);
        const vendor = randomChoice(pattern.vendors);

        const expense = await Expense.create({
          flatId: flat._id,
          createdBy: paidBy._id,
          title: `${vendor} - ${category.charAt(0).toUpperCase() + category.slice(1)}`,
          description: `${category} expense from ${vendor}`,
          totalAmount: amount,
          category: category,
          splitMethod: 'equal',
          status: 'settled',
          participants: users.map(u => ({
            userId: u._id,
            name: u.userName,
            amount: Math.round(amount / users.length),
            isPaid: true
          })),
          notes: TEST_TAG,
          createdAt: expenseDate.toDate()
        });
        allExpenses.push(expense);

        // Create transactions for expense settlements
        const shareAmount = Math.round(amount / users.length);
        for (const user of users) {
          if (user._id.toString() === paidBy._id.toString()) continue;

          const txn = await Transaction.create({
            flatId: flat._id,
            type: 'payment',
            amount: shareAmount,
            fromUserId: user._id,
            toUserId: paidBy._id,
            note: `${category} expense settlement ${TEST_TAG}`,
            paymentMethod: Math.random() < 0.7 ? 'upi' : 'cash',
            status: 'completed',
            createdAt: expenseDate.add(rand(1, 3), 'day').toDate()
          });
          allTransactions.push(txn);
        }
      }
    }

    console.log(`  ✅ Created ${allExpenses.filter(e => dayjs(e.createdAt).format('YYYY-MM') === monthKey).length} expenses`);
  }

  console.log();

  // 3. Create budget snapshots with accurate calculations
  console.log('📊 Creating budget snapshots...\n');
  for (let monthOffset = NUM_MONTHS - 1; monthOffset >= 0; monthOffset--) {
    const monthStart = today.subtract(monthOffset, 'month').startOf('month');
    const monthEnd = monthStart.endOf('month');
    const month = monthStart.format('YYYY-MM');

    const monthBills = allBills.filter(b => dayjs(b.dueDate).format('YYYY-MM') === month);
    const monthExpenses = allExpenses.filter(e => dayjs(e.createdAt).format('YYYY-MM') === month);

    const billsTotal = monthBills.reduce((sum, b) => sum + b.totalAmount, 0);
    const expensesTotal = monthExpenses.reduce((sum, e) => sum + e.totalAmount, 0);
    const actualSpent = billsTotal + expensesTotal;

    // Category breakdown
    const categoryBreakdown = {};
    monthBills.forEach(b => {
      categoryBreakdown[b.category] = (categoryBreakdown[b.category] || 0) + b.totalAmount;
    });
    monthExpenses.forEach(e => {
      categoryBreakdown[e.category] = (categoryBreakdown[e.category] || 0) + e.totalAmount;
    });

    await BudgetSnapshot.create({
      flatId: flat._id,
      month,
      budgetAmount: MONTHLY_BUDGET,
      predictedAmount: MONTHLY_BUDGET,
      actualSpent,
      categoryBreakdown,
      notes: TEST_TAG
    });

    console.log(`  ${month}: ₹${actualSpent.toLocaleString('en-IN')} spent (${Object.keys(categoryBreakdown).length} categories)`);
  }

  console.log();
  console.log('🎉 Seed Complete!');
  console.log('================');
  console.log(`📊 Bills: ${allBills.length}`);
  console.log(`💰 Expenses: ${allExpenses.length}`);
  console.log(`💳 Transactions: ${allTransactions.length}`);
  console.log(`📈 Budget Snapshots: ${NUM_MONTHS}`);
  console.log(`👥 Users: ${users.length}`);
  console.log(`🏢 Flats: 1`);
}

(async () => {
  try {
    await connect();
    
    if (process.argv.includes('--cleanup')) {
      await cleanup();
      process.exit(0);
    }

    await cleanup();
    await seed();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
})();
