/**
 * Unified Report Controller (Optimized)
 * Consolidates all report generation endpoints with improved performance
 * Replaces legacy report.controller.js with cleaner, faster implementation
 */

import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import reportService from "../services/report.service.js";
import * as FileSystem from 'fs/promises';
import path from 'path';

/**
 * @route GET /api/v2/reports/flats/:flatId/complete
 * @desc Get complete financial report (replaces monthly + categories + summary)
 * @access Private
 * @query month - Optional month in YYYY-MM format
 */
export const getCompleteReport = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month } = req.query;

    const report = await reportService.getCompleteFinancialReport(
        flatId,
        month,
        req.user._id
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            report,
            "Complete financial report fetched successfully"
        )
    );
});

/**
 * @route GET /api/v2/reports/flats/:flatId/forecast
 * @desc Get ML-powered budget forecast (optimized)
 * @access Private
 * @query months - Number of months to forecast (default: 3)
 */
export const getForecast = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { months = 3 } = req.query;

    const forecast = await reportService.getForecast(
        flatId,
        req.user._id,
        parseInt(months)
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            forecast,
            forecast.usedML 
                ? "ML budget forecast generated successfully"
                : "Budget forecast generated (fallback mode)"
        )
    );
});

/**
 * @route GET /api/v2/reports/flats/:flatId/categories
 * @desc Get category-wise spending analysis
 * @access Private
 * @query startDate, endDate - Optional date range
 */
export const getCategoryAnalysis = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { startDate, endDate } = req.query;

    const analysis = await reportService.getCategoryAnalysis(
        flatId,
        { startDate, endDate }
    );

    return res.status(200).json(
        new ApiResponse(200, analysis, "Category analysis fetched successfully")
    );
});

/**
 * @route POST /api/v2/reports/flats/:flatId/invalidate-cache
 * @desc Invalidate report cache (call after bill/payment changes)
 * @access Private
 */
export const invalidateCache = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month } = req.body;

    await reportService.invalidateCache(flatId, month);

    return res.status(200).json(
        new ApiResponse(200, {}, "Cache invalidated successfully")
    );
});

/**
 * @route GET /api/v2/reports/flats/:flatId/export
 * @desc Export report as CSV (improved format)
 * @access Private
 * @query month - Month in YYYY-MM format
 * @query format - 'csv' or 'json' (default: 'json')
 */
export const exportReport = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month, format = 'json' } = req.query;

    const report = await reportService.getCompleteFinancialReport(
        flatId,
        month,
        req.user._id
    );

    if (format === 'csv') {
        // Generate enhanced CSV with multiple sections
        let csvContent = '';

        // Header section
        csvContent += `Smart Rent - Financial Report\n`;
        csvContent += `Month: ${report.month}\n`;
        csvContent += `Generated: ${new Date().toISOString()}\n`;
        csvContent += `\n`;

        // Summary section
        csvContent += `SUMMARY\n`;
        csvContent += `Total Spent,Budget,Remaining,% Used\n`;
        csvContent += `${report.summary.totalSpent},${report.summary.budget},${report.summary.budgetRemaining},${report.summary.percentageUsed}%\n`;
        csvContent += `\n`;

        // Category breakdown
        csvContent += `CATEGORY BREAKDOWN\n`;
        csvContent += `Category,Amount,Count,Average,Percentage\n`;
        report.categoryBreakdown.forEach(cat => {
            csvContent += `${cat.category},${cat.totalAmount},${cat.count},${cat.avgAmount},${cat.percentage}%\n`;
        });
        csvContent += `\n`;

        // Recent transactions
        csvContent += `RECENT TRANSACTIONS\n`;
        csvContent += `Date,Title,Category,Amount,Status,Type\n`;
        report.recentActivity.forEach(txn => {
            const date = new Date(txn.dueDate || txn.createdAt).toLocaleDateString();
            csvContent += `${date},${txn.title},${txn.category},${txn.totalAmount},${txn.status},${txn.type}\n`;
        });

        // Set CSV headers
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=report-${report.month}.csv`);
        
        return res.send(csvContent);
    }

    // JSON format
    return res.status(200).json(
        new ApiResponse(200, report, "Report exported successfully")
    );
});

/**
 * @route GET /api/v2/reports/flats/:flatId/dashboard
 * @desc Get optimized dashboard data (minimal payload)
 * @access Private
 */
export const getDashboardSummary = asyncHandler(async (req, res) => {
    const { flatId } = req.params;

    const report = await reportService.getCompleteFinancialReport(
        flatId,
        null, // Current month
        req.user._id
    );

    // Return only essential dashboard data
    const dashboardData = {
        summary: report.summary,
        topCategories: report.categoryBreakdown.slice(0, 5),
        userDues: report.userDues,
        recentActivity: report.recentActivity.slice(0, 5),
        budgetStatus: {
            budget: report.summary.budget,
            spent: report.summary.totalSpent,
            remaining: report.summary.budgetRemaining,
            percentageUsed: report.summary.percentageUsed,
            isOverBudget: report.summary.isOverBudget
        }
    };

    return res.status(200).json(
        new ApiResponse(200, dashboardData, "Dashboard summary fetched successfully")
    );
});

export default {
    getCompleteReport,
    getForecast,
    getCategoryAnalysis,
    invalidateCache,
    exportReport,
    getDashboardSummary
};
