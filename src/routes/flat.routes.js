import { Router } from "express";
import {
    createFlat,
    joinFlat,
    getUserFlat,
    getFlatByJoinCode,
    updateFlat,
    leaveFlat,
    deleteFlat,
    getFlatMembers,
    generateInviteLink,
    removeMember,
    transferAdmin,
    updateMemberRole
} from "../controllers/flat.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { validate, createFlatSchema, joinFlatSchema, updateFlatSchema } from "../Utils/validation.js";

const router = Router();

// Public route
router.route("/preview/:joinCode").get(getFlatByJoinCode);

// Protected routes
router.use(verifyJWT);

router.route("/").post(validate(createFlatSchema), createFlat);
router.route("/join").post(validate(joinFlatSchema), joinFlat);
router.route("/current").get(getUserFlat);
router.route("/:flatId").put(validate(updateFlatSchema), updateFlat).delete(deleteFlat);
router.route("/:flatId/leave").post(leaveFlat);

// Member management
router.route("/:flatId/members").get(getFlatMembers);
router.route("/:flatId/invite").post(generateInviteLink);
router.route("/:flatId/members/:memberId").delete(removeMember);
router.route("/:flatId/members/:memberId/role").put(updateMemberRole);
router.route("/:flatId/transfer-admin").post(transferAdmin);

export default router;