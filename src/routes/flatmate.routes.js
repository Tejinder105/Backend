import { Router } from "express";
import {
    getAllFlatmates,
    getActiveFlatmates,
    addFlatmate,
    updateFlatmate,
    removeFlatmate,
    reactivateFlatmate,
    getFlatmateStats,
    getInvitationByToken,
    acceptInvitation,
    getUserInvitations,
    cancelInvitation,
    resendInvitationSMS
} from "../controllers/flatmate.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

// Public routes (no authentication required)
router.route("/invitation/:token").get(getInvitationByToken);
router.route("/invitation/:token/accept").post(acceptInvitation);

// Apply authentication middleware to protected routes
router.use(verifyJWT);

// Flatmate routes
router.route("/").get(getAllFlatmates).post(addFlatmate);
router.route("/active").get(getActiveFlatmates);
router.route("/stats").get(getFlatmateStats);
router.route("/:flatmateId").put(updateFlatmate).delete(removeFlatmate);
router.route("/:flatmateId/reactivate").post(reactivateFlatmate);

// Invitation management routes
router.route("/invitations").get(getUserInvitations);
router.route("/invitations/:invitationId/cancel").post(cancelInvitation);
router.route("/invitations/:invitationId/resend-sms").post(resendInvitationSMS);

export default router;