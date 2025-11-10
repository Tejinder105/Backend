import { Router } from 'express';
import {
    updateFlatBudget,
    getCurrentBudgetStatus,
    getBudgetHistory,
    updateBudgetSnapshot
} from '../controllers/budget.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

// Protect all routes
router.use(verifyJWT);

// Budget management
router.put('/flats/:flatId/budget', updateFlatBudget);
router.get('/flats/:flatId/budget/current', getCurrentBudgetStatus);
router.get('/flats/:flatId/budget/history', getBudgetHistory);
router.put('/flats/:flatId/budget/snapshot', updateBudgetSnapshot);

export default router;
