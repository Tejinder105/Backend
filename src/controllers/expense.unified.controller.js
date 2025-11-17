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
 * @route POST /api/expenses/pay-bulk
 * @desc Record bulk payment for multiple expenses
 * @access Private
 */
export const recordBulkPayment = asyncHandler(async (req, res) => {
    const { payments } = req.body;
    
    if (!payments || !Array.isArray(payments) || payments.length === 0) {
        throw new ApiError(400, "Payments array is required");
    }
    
    const results = [];
    const errors = [];
    
    // Process each payment
    for (const payment of payments) {
        try {
            const result = await expenseService.recordPayment(payment, req.user._id);
            results.push({
                expenseId: payment.expenseId,
                success: true,
                data: result
            });
        } catch (error) {
            errors.push({
                expenseId: payment.expenseId,
                success: false,
                error: error.message
            });
        }
    }
    
    const allSuccess = errors.length === 0;
    
    return res.status(allSuccess ? 200 : 207).json(
        new ApiResponse(
            allSuccess ? 200 : 207,
            { results, errors, successCount: results.length, errorCount: errors.length },
            allSuccess 
                ? `Successfully processed ${results.length} payment(s)` 
                : `Processed ${results.length} payment(s) with ${errors.length} error(s)`
        )
    );
});

/**
 * @route GET /api/expenses/dues
 * @desc Get user's pending dues for a flat
 * @access Private
 */
export const getUserDues = asyncHandler(async (req, res) => {
    const { flatId } = req.query;
    
    if (!flatId) {
        throw new ApiError(400, "flatId query parameter is required");
    }
    
    const dues = await expenseService.getUserDues(req.user._id, flatId);
    
    return res.status(200).json(
        new ApiResponse(200, dues, "User dues fetched successfully")
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
    recordBulkPayment,
    getUserDues,
    getFinancialSummary,
    getExpenseHistory
};
