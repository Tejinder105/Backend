import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { BudgetSnapshot } from "../models/budgetSnapshot.model.js";
import { Flat } from "../models/flat.model.js";
import { Bill } from "../models/bill.model.js";

// Update flat monthly budget
export const updateFlatBudget = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { monthlyBudget } = req.body;

    if (!monthlyBudget || monthlyBudget < 0) {
        throw new ApiError(400, "Valid monthly budget is required");
    }

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id)) {
        throw new ApiError(403, "Only admin can update flat budget");
    }

    flat.monthlyBudget = monthlyBudget;
    await flat.save();

    return res.status(200).json(
        new ApiResponse(200, { monthlyBudget: flat.monthlyBudget }, "Budget updated successfully")
    );
});

// Get current month budget status
export const getCurrentBudgetStatus = asyncHandler(async (req, res) => {
    const { flatId } = req.params;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Get current month
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Get or create snapshot for current month
    let snapshot = await BudgetSnapshot.getOrCreate(flatId, currentMonth, flat.monthlyBudget);
    
    // Update actual spent from bills
    await snapshot.updateActualSpent();

    // Reload to get virtuals
    snapshot = await BudgetSnapshot.findById(snapshot._id);

    return res.status(200).json(
        new ApiResponse(200, {
            monthlyBudget: flat.monthlyBudget,
            actualSpent: snapshot.actualSpent,
            remaining: flat.monthlyBudget - snapshot.actualSpent,
            variance: snapshot.budgetAmount - snapshot.actualSpent,
            variancePercentage: snapshot.variancePercentage,
            percentUsed: flat.monthlyBudget > 0 ? (snapshot.actualSpent / flat.monthlyBudget) * 100 : 0,
            categoryBreakdown: snapshot.categoryBreakdown,
            month: currentMonth
        }, "Current budget status")
    );
});

// Get budget history (last N months)
export const getBudgetHistory = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { months = 6 } = req.query;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id) && !flat.isMember(req.user._id)) {
        throw new ApiError(403, "You don't have access to this flat");
    }

    // Get last N months of snapshots
    const snapshots = await BudgetSnapshot.find({ flatId })
        .sort({ month: -1 })
        .limit(parseInt(months));

    const history = snapshots.map(snapshot => ({
        month: snapshot.month,
        budgetAmount: snapshot.budgetAmount,
        actualSpent: snapshot.actualSpent,
        variance: snapshot.budgetAmount - snapshot.actualSpent,
        percentUsed: snapshot.budgetAmount > 0 ? (snapshot.actualSpent / snapshot.budgetAmount) * 100 : 0,
        categoryBreakdown: snapshot.categoryBreakdown
    }));

    return res.status(200).json(
        new ApiResponse(200, { history, flatMonthlyBudget: flat.monthlyBudget }, "Budget history fetched")
    );
});

// Create or update budget snapshot
export const updateBudgetSnapshot = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month, notes } = req.body;

    const flat = await Flat.findById(flatId);
    if (!flat) {
        throw new ApiError(404, "Flat not found");
    }

    if (!flat.isAdmin(req.user._id)) {
        throw new ApiError(403, "Only admin can update budget snapshots");
    }

    let snapshot = await BudgetSnapshot.findOne({ flatId, month });
    
    if (!snapshot) {
        snapshot = await BudgetSnapshot.create({
            flatId,
            month,
            budgetAmount: flat.monthlyBudget,
            notes
        });
    } else {
        snapshot.notes = notes;
        await snapshot.save();
    }

    // Update actual spent
    await snapshot.updateActualSpent();

    return res.status(200).json(
        new ApiResponse(200, snapshot, "Budget snapshot updated")
    );
});
