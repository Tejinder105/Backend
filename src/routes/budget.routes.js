import { Router } from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { BudgetSnapshot } from "../models/budgetSnapshot.model.js";

const router = Router();

// All routes require authentication
router.use(verifyJWT);

/**
 * @route   GET /api/budgets/flat/:flatId
 * @desc    Get current month's budget snapshot for a flat
 * @access  Private (Flat member)
 */
router.get("/flat/:flatId", async (req, res) => {
  try {
    const { flatId } = req.params;
    
    // Get current month's snapshot
    const snapshot = await BudgetSnapshot.getCurrentMonthSnapshot(flatId);
    
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: "No budget snapshot found for current month"
      });
    }

    res.status(200).json({
      success: true,
      data: snapshot
    });
  } catch (error) {
    console.error("Error fetching budget snapshot:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch budget snapshot"
    });
  }
});

/**
 * @route   GET /api/budgets/flat/:flatId/history
 * @desc    Get budget history for a flat
 * @access  Private (Flat member)
 */
router.get("/flat/:flatId/history", async (req, res) => {
  try {
    const { flatId } = req.params;
    const { limit = 12 } = req.query; // Default to last 12 months
    
    const snapshots = await BudgetSnapshot.find({ flatId })
      .sort({ year: -1, month: -1 })
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({
      success: true,
      data: snapshots
    });
  } catch (error) {
    console.error("Error fetching budget history:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch budget history"
    });
  }
});

/**
 * @route   GET /api/budgets/flat/:flatId/month/:year/:month
 * @desc    Get specific month's budget snapshot
 * @access  Private (Flat member)
 */
router.get("/flat/:flatId/month/:year/:month", async (req, res) => {
  try {
    const { flatId, year, month } = req.params;
    
    const snapshot = await BudgetSnapshot.findOne({
      flatId,
      year: parseInt(year),
      month: parseInt(month)
    });

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: "Budget snapshot not found for specified month"
      });
    }

    res.status(200).json({
      success: true,
      data: snapshot
    });
  } catch (error) {
    console.error("Error fetching budget snapshot:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch budget snapshot"
    });
  }
});

export default router;
