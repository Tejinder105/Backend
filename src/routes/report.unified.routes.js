/**
 * Unified Report Routes (V2 - Optimized)
 * Consolidates all report endpoints with improved performance
 */

import { Router } from 'express';
import {
    getCompleteReport,
    getForecast,
    getCategoryAnalysis,
    invalidateCache,
    exportReport,
    getDashboardSummary
} from '../controllers/report.unified.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';

const router = Router();

// Protect all routes
router.use(verifyJWT);

/**
 * @route GET /api/v2/reports/flats/:flatId/complete
 * @desc Get complete financial report (monthly + categories + summary in ONE call)
 * @query month - Optional YYYY-MM format
 * @returns Complete financial report with all breakdowns
 */
router.get('/flats/:flatId/complete', getCompleteReport);

/**
 * @route GET /api/v2/reports/flats/:flatId/dashboard
 * @desc Get optimized dashboard summary (minimal payload)
 * @returns Essential dashboard data only
 */
router.get('/flats/:flatId/dashboard', getDashboardSummary);

/**
 * @route GET /api/v2/reports/flats/:flatId/forecast
 * @desc Get ML-powered budget forecast (optimized single-query)
 * @query months - Number of months to forecast (default: 3)
 * @returns Forecast predictions with confidence levels
 */
router.get('/flats/:flatId/forecast', getForecast);

/**
 * @route GET /api/v2/reports/flats/:flatId/categories
 * @desc Get category-wise spending analysis
 * @query startDate, endDate - Optional date range
 * @returns Category breakdown with percentages
 */
router.get('/flats/:flatId/categories', getCategoryAnalysis);

/**
 * @route GET /api/v2/reports/flats/:flatId/export
 * @desc Export report as CSV or JSON
 * @query month - YYYY-MM format
 * @query format - 'csv' or 'json' (default: 'json')
 * @returns File download or JSON response
 */
router.get('/flats/:flatId/export', exportReport);

/**
 * @route POST /api/v2/reports/flats/:flatId/invalidate-cache
 * @desc Manually invalidate report cache (useful after bulk operations)
 * @body month - Optional YYYY-MM format
 * @returns Success message
 */
router.post('/flats/:flatId/invalidate-cache', invalidateCache);

export default router;
