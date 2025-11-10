import { Router } from 'express';
import {
    getMonthlyReport,
    setFlatBudget,
    forecastBudget,
    getCategorySpending,
    exportReport
} from '../controllers/report.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate, setBudgetSchema } from '../Utils/validation.js';

const router = Router();

// Protect all routes
router.use(verifyJWT);

// Monthly reports
router.get('/flats/:flatId/monthly', getMonthlyReport);

// Budget management
router.post('/flats/:flatId/budget', validate(setBudgetSchema), setFlatBudget);
router.get('/flats/:flatId/budget/forecast', forecastBudget);

// Category spending
router.get('/flats/:flatId/categories', getCategorySpending);

// Export report
router.get('/flats/:flatId/export', exportReport);

export default router;
