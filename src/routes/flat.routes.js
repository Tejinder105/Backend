import { Router } from "express";
import {
    createFlat,
    joinFlat,
    getUserFlat,
    getFlatByJoinCode,
    updateFlat,
    leaveFlat,
    deleteFlat,
    getFlatMembers
} from "../controllers/flat.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

const router = Router();

// Public routes
router.route("/preview/:joinCode").get(getFlatByJoinCode);


// Protected routes
router.use(verifyJWT);

// Flat management
router.route("/").post(createFlat);
router.route("/join").post(joinFlat);
router.route("/current").get(getUserFlat);
router.route("/:flatId").put(updateFlat).delete(deleteFlat);
router.route("/:flatId/leave").post(leaveFlat);

// Member management
router.route("/:flatId/members").get(getFlatMembers);


export default router;