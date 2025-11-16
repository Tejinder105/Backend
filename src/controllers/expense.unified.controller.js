/**
 * Unified Expense Controller
 * Consolidates Bills and Expenses into single API
 */

import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import expenseService from "../services/expense.service.js";

/**
 * @route POST /api/expenses
 * @desc Create a new expense (bill or split)
 * @access Private
 */
export const createExpense = asyncHandler(async (req, res) => {
    const result = await expenseService.createExpense(req.body, req.user._id);
    
    return res.status(201).json(
        new ApiResponse(
            201,
            result,
            `${result.type === 'shared' ? 'Bill' : 'Expense'} created successfully`
        )
    );
});

/**
 * @route POST /api/expenses/pay
 * @desc Record payment for one or more expenses
 * @access Private
 */
export const recordPayment = asyncHandler(async (req, res) => {
    const result = await expenseService.recordPayment(req.body, req.user._id);
    
    return res.status(200).json(
        new ApiResponse(200, result, "Payment recorded successfully")
    );
});

/**
 * @route GET /api/flats/:flatId/financials
 * @desc Get complete financial summary (replaces multiple API calls)
 * @access Private
 */
export const getFinancialSummary = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month } = req.query;
    
    const summary = await expenseService.getFinancialSummary(
        flatId,
        month,
        req.user._id
    );
    
    return res.status(200).json(
        new ApiResponse(200, summary, "Financial summary fetched successfully")
    );
});

/**
 * @route GET /api/expenses/flat/:flatId
 * @desc Get expense history for a flat (paginated)
 * @access Private
 */
export const getExpenseHistory = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { 
        category, 
        status, 
        startDate, 
        endDate,
        page = 1,
        limit = 20
    } = req.query;
    
    const filters = {};
    if (category) filters.category = category;
    if (status) filters.status = status;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    const result = await expenseService.getExpenseHistory(
        flatId,
        filters,
        parseInt(page),
        parseInt(limit)
    );
    
    return res.status(200).json(
        new ApiResponse(200, result, "Expense history fetched successfully")
    );
});

// Export all functions
export default {
    createExpense,
    recordPayment,
    getFinancialSummary,
    getExpenseHistory
};
