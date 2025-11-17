/**
 * Unified Report Controller (Optimized)
 * Consolidates all report generation endpoints with improved performance
 * Replaces legacy report.controller.js with cleaner, faster implementation
 */

import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import reportService from "../services/report.service.js";
import PDFDocument from 'pdfkit';
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
 * @desc Get ML-powered budget forecast - predicts ONLY next month
 * @access Private
 */
export const getForecast = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    // Fixed to only predict next month (1 month)
    const months = 1;

    const forecast = await reportService.getForecast(
        flatId,
        req.user._id,
        months
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
 * @desc Export report as CSV or PDF
 * @access Private
 * @query month - Month in YYYY-MM format
 * @query format - 'csv', 'pdf', or 'json' (default: 'json')
 */
export const exportReport = asyncHandler(async (req, res) => {
    const { flatId } = req.params;
    const { month, format = 'json' } = req.query;

    const report = await reportService.getCompleteFinancialReport(
        flatId,
        month,
        req.user._id
    );

    if (format === 'pdf') {
        const doc = new PDFDocument({ margin: 50 });

        // Set PDF headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=report-${report.month}.pdf`);
        
        // Pipe PDF to response
        doc.pipe(res);

        // Title
        doc.fontSize(24).font('Helvetica-Bold').text('Smart Rent', { align: 'center' });
        doc.fontSize(18).text('Financial Report', { align: 'center' });
        doc.moveDown(0.5);
        
        // Report details
        doc.fontSize(12).font('Helvetica').text(`Month: ${report.month}`, { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown(2);

        // Summary Section
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#3b82f6').text('Summary');
        doc.moveDown(0.5);
        
        const summaryY = doc.y;
        doc.fontSize(11).font('Helvetica').fillColor('black');
        doc.rect(50, summaryY, 495, 80).fillAndStroke('#f0f9ff', '#3b82f6');
        
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e40af')
           .text(`Total Spent: ₹${report.summary.totalSpent.toFixed(2)}`, 70, summaryY + 15);
        doc.text(`Budget: ₹${report.summary.budget.toFixed(2)}`, 70, summaryY + 35);
        doc.text(`Remaining: ₹${report.summary.budgetRemaining.toFixed(2)}`, 70, summaryY + 55);
        
        doc.text(`${report.summary.percentageUsed.toFixed(1)}% Used`, 350, summaryY + 15);
        doc.text(report.summary.isOverBudget ? 'Over Budget' : 'On Track', 350, summaryY + 35, {
            color: report.summary.isOverBudget ? '#dc2626' : '#16a34a'
        });
        
        doc.moveDown(6);

        // Category Breakdown
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#3b82f6').text('Category Breakdown');
        doc.moveDown(0.5);
        
        const tableTop = doc.y;
        const colWidths = [150, 100, 80, 80, 85];
        const headers = ['Category', 'Amount', 'Count', 'Average', 'Percentage'];
        
        // Table header
        doc.fontSize(11).font('Helvetica-Bold').fillColor('white');
        doc.rect(50, tableTop, 495, 25).fill('#3b82f6');
        let xPos = 60;
        headers.forEach((header, i) => {
            doc.text(header, xPos, tableTop + 7, { width: colWidths[i] });
            xPos += colWidths[i];
        });
        
        // Table rows
        doc.font('Helvetica').fillColor('black');
        let yPos = tableTop + 30;
        report.categoryBreakdown.slice(0, 10).forEach((cat, index) => {
            if (yPos > 700) {
                doc.addPage();
                yPos = 50;
            }
            
            const bgColor = index % 2 === 0 ? '#f9fafb' : 'white';
            doc.rect(50, yPos, 495, 25).fill(bgColor);
            
            xPos = 60;
            doc.fillColor('black')
               .text(cat.category.toUpperCase(), xPos, yPos + 7, { width: colWidths[0] });
            xPos += colWidths[0];
            doc.text(`₹${cat.totalAmount.toFixed(2)}`, xPos, yPos + 7, { width: colWidths[1] });
            xPos += colWidths[1];
            doc.text(cat.count.toString(), xPos, yPos + 7, { width: colWidths[2] });
            xPos += colWidths[2];
            doc.text(`₹${cat.avgAmount.toFixed(2)}`, xPos, yPos + 7, { width: colWidths[3] });
            xPos += colWidths[3];
            doc.text(`${cat.percentage.toFixed(1)}%`, xPos, yPos + 7, { width: colWidths[4] });
            
            yPos += 25;
        });
        
        doc.moveDown(2);

        // Recent Transactions
        if (yPos > 650) doc.addPage();
        
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#3b82f6').text('Recent Transactions');
        doc.moveDown(0.5);
        
        doc.fontSize(10).font('Helvetica').fillColor('black');
        report.recentActivity.slice(0, 15).forEach((txn) => {
            if (doc.y > 700) doc.addPage();
            
            const date = new Date(txn.dueDate || txn.createdAt).toLocaleDateString();
            doc.text(`${date} - ${txn.title}`, 60);
            doc.text(`₹${txn.totalAmount.toFixed(2)} (${txn.status})`, 400, doc.y - 12, { align: 'right' });
            doc.moveDown(0.3);
        });

        // Footer
        const pageCount = doc.bufferedPageRange().count;
        for (let i = 0; i < pageCount; i++) {
            doc.switchToPage(i);
            doc.fontSize(9).fillColor('gray')
               .text(`Page ${i + 1} of ${pageCount}`, 50, 750, { align: 'center' });
        }

        doc.end();
        return;
    }

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
