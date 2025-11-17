import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { getCurrentBudget, getBudgetHistory, getBudgetForecast } from "../controllers/budget.controller.js";

const router = Router();

// All routes require authentication
router.use(verifyJWT);

/**
 * V2 Routes - Using controller
 * Frontend calls: /budgets/flat/:flatId (expects current month)
 * Frontend calls: /budgets/flat/:flatId/history (expects history)
 * Frontend calls: /budgets/flat/:flatId/forecast (expects ML predictions)
 */
router.get("/flat/:flatId", getCurrentBudget); // Default to current month
router.get("/flat/:flatId/current", getCurrentBudget); // Explicit current month
router.get("/flat/:flatId/history", getBudgetHistory); // History
router.get("/flat/:flatId/forecast", getBudgetForecast); // ML forecast

export default router;
