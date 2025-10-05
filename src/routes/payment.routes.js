import { Router } from "express";
import {
    getUserPayments,
    getOutstandingDues,
    createPayment,
    processPayment,
    updatePayment,
    deletePayment,
    getPaymentStats
} from "../controllers/payment.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyJWT);

// Payment routes
router.route("/").get(getUserPayments).post(createPayment);
router.route("/outstanding").get(getOutstandingDues);
router.route("/stats").get(getPaymentStats);
router.route("/:paymentId").put(updatePayment).delete(deletePayment);
router.route("/:paymentId/process").post(processPayment);

export default router;