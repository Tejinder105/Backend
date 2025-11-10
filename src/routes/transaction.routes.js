import { Router } from 'express';
import {
    payDues,
    createTransaction,
    getFlatTransactions,
    getUserTransactions,
    getTransactionSummary
} from '../controllers/transaction.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate, createTransactionSchema, payDuesSchema } from '../Utils/validation.js';

const router = Router();

// Protect all routes
router.use(verifyJWT);

// Pay dues
router.post('/pay', validate(payDuesSchema), payDues);

// Manual transaction creation (admin only)
router.post('/flats/:flatId', validate(createTransactionSchema), createTransaction);

// Get transactions
router.get('/flats/:flatId', getFlatTransactions);
router.get('/flats/:flatId/summary', getTransactionSummary);
router.get('/users/:userId', getUserTransactions);
router.get('/user', getUserTransactions); // Current user transactions

export default router;
