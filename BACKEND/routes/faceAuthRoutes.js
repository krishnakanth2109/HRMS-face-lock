// --- routes/faceAuthRoutes.js ---
import express from "express";
import { protect } from "../controllers/authController.js";
import {
  registerFace,
  loginWithFace,
  checkFaceRegistration,
  deleteFaceRegistration,
} from "../controllers/faceAuthController.js";

const router = express.Router();

// Public route - no auth needed (this IS the login)
router.post("/login", loginWithFace);

// Protected routes - user must be logged in
router.post("/register", protect, registerFace);
router.get("/status", protect, checkFaceRegistration);
router.delete("/remove", protect, deleteFaceRegistration);

export default router;

