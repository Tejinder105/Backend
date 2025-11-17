/**
 * Unified Expense Routes
 * Consolidates Bills and Expenses into single clean API
 */

import { Router } from 'express';
import {
    createExpense,
    recordPayment,
    recordBulkPayment,
    getUserDues,
    getFinancialSummary,
    getExpenseHistory
} from '../controllers/expense.unified.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate, createExpenseSchema, recordPaymentSchema } from '../Utils/validation.js';

const router = Router();

// Protect all routes
router.use(verifyJWT);

/**
 * @route POST /api/expenses
 * @desc Create new expense (bill or split)
 * @body {
 *   flatId: ObjectId,
 *   type: 'shared' | 'split',
 *   title: String,
 *   totalAmount: Number,
 *   category: String,
 *   participants: Array,
 *   splitMethod: 'equal' | 'custom',
 *   dueDate: Date (for bills),
 *   ... other fields
 * }
 */
router.post('/', validate(createExpenseSchema), createExpense);

/**
 * @route POST /api/expenses/pay
 * @desc Record bulk payment for multiple expenses
 * @body {
 *   payments: Array<{
 *     expenseId: ObjectId,
 *     expenseType: 'bill' | 'expense',
 *     amount: Number,
 *     paymentMethod: String,
 *     note: String
 *   }>
 * }
 */
router.post('/pay', recordBulkPayment);

/**
 * @route GET /api/expenses/dues
 * @desc Get user's pending dues for a flat
 * @query flatId: ObjectId (required)
 * @returns {
 *   billDues: Array,
 *   expenseDues: Array,
 *   totalDue: Number
 * }
 */
router.get('/dues', getUserDues);

/**
 * @route GET /api/flats/:flatId/financials
 * @desc Get complete financial summary (replaces 4+ API calls)
 * @query month: String (YYYY-MM, optional)
 * @returns {
 *   summary: Object,
 *   bills: Object,
 *   expenses: Object,
 *   transactions: Array,
 *   budgetSnapshot: Object,
 *   userDues: Object
 * }
 */
router.get('/flats/:flatId/financials', getFinancialSummary);

/**
 * @route GET /api/expenses/flat/:flatId
 * @desc Get expense history (paginated)
 * @query category: String
 * @query status: String
 * @query startDate: Date
 * @query endDate: Date
 * @query page: Number
 * @query limit: Number
 */
router.get('/flat/:flatId', getExpenseHistory);

export default router;
