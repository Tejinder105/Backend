import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
} from "../controllers/user.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { validate, registerUserSchema, loginUserSchema, updateUserSchema } from "../Utils/validation.js";

const router = Router();

// Public routes
router.post("/register", validate(registerUserSchema), registerUser);
router.post("/login", validate(loginUserSchema), loginUser);
router.post("/refresh-token", refreshAccessToken);

// Protected routes
router.post("/logout", verifyJWT, logoutUser);
router.get("/me", verifyJWT, getCurrentUser);
router.put("/update", verifyJWT, validate(updateUserSchema), updateAccountDetails);
router.put("/change-password", verifyJWT, changeCurrentPassword);

export default router;
