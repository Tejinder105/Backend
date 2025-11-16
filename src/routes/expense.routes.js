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
    getFlatExpenses,
    createUnifiedExpense,
    recordBulkPayment,
    getUserDues,
    getExpenseHistory
} from "../controllers/expense.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

// Unified endpoints (using ExpenseService)
router.route("/unified").post(createUnifiedExpense);
router.route("/pay").post(recordBulkPayment);
router.route("/dues").get(getUserDues);
router.route("/history").get(getExpenseHistory);

// Legacy endpoints (backward compatibility)
router.route("/").get(getUserExpenses).post(createSplitExpense);
router.route("/created").get(getCreatedExpenses);
router.route("/participant").get(getParticipantExpenses);
router.route("/flat").get(getFlatExpenses);
router.route("/stats").get(getExpenseStats);
router.route("/flatmates").get(getAvailableFlatmates);
router.route("/:expenseId").put(updateExpense).delete(deleteExpense);
router.route("/:expenseId/participants/:participantUserId/pay").post(markParticipantPaid);

export default router;