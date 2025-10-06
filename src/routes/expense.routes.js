import { Router } from "express";
import {
    getUserExpenses,
    getCreatedExpenses,
    getParticipantExpenses,
    createSplitExpense,
    markParticipantPaid,
    updateExpense,
    deleteExpense,
    getExpenseStats,
    getAvailableFlatmates,
    getFlatExpenses
} from "../controllers/expense.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

// Expense routes
router.route("/").get(getUserExpenses).post(createSplitExpense);
router.route("/created").get(getCreatedExpenses);
router.route("/participant").get(getParticipantExpenses);
router.route("/flat").get(getFlatExpenses);
router.route("/stats").get(getExpenseStats);
router.route("/flatmates").get(getAvailableFlatmates);
router.route("/:expenseId").put(updateExpense).delete(deleteExpense);
router.route("/:expenseId/participants/:participantUserId/pay").post(markParticipantPaid);

export default router;