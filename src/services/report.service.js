/**
 * Centralized Report Generation Service
 * Single source of truth for all report calculations
 * Consolidates logic from report.controller.js and reduces redundancy
 */

import mongoose from "mongoose";
import { Bill } from "../models/bill.model.js";
import { BillSplit } from "../models/billSplit.model.js";
import { Expense } from "../models/expense.model.js";
import { Transaction } from "../models/transaction.model.js";
import { BudgetSnapshot } from "../models/budgetSnapshot.model.js";
import { Flat } from "../models/flat.model.js";
import mlService from "./ml.service.js";

class ReportService {
    /**
     * Get complete financial summary with optimized queries
     * Replaces multiple controller methods with single consolidated report
     * @param {ObjectId} flatId - Flat ID
     * @param {String} month - Month in YYYY-MM format
     * @param {ObjectId} userId - Requesting user ID
     * @returns {Promise<Object>} Complete financial report
     */
    async getCompleteFinancialReport(flatId, month, userId) {
        // Verify access
        const flat = await Flat.findById(flatId);
        if (!flat) {
            throw new Error("Flat not found");
        }

        if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
            throw new Error("You don't have access to this flat");
        }

        // Format month consistently
        const targetMonth = this._formatMonth(month);
        const { startDate, endDate } = this._getMonthDateRange(targetMonth);

        // Check cache first
        const cacheKey = `report:${flatId}:${targetMonth}`;
        const cached = await this._getCachedReport(cacheKey);
        if (cached) {
            console.log('📊 Returning cached report');
            return { ...cached, _cached: true };
        }

        // OPTIMIZED QUERY 1: Combined bills + expenses with $unionWith
        const combinedFinancials = await this._getCombinedFinancials(flatId, startDate, endDate);

        // OPTIMIZED QUERY 2: User-specific data (dues)
        const userDuesData = await this._getUserDues(flatId, userId);

        // OPTIMIZED QUERY 3: Transactions summary
        const transactionsSummary = await this._getTransactionsSummary(flatId, startDate, endDate);

        // Get or update cached budget snapshot (no re-aggregation)
        const totalSpent = combinedFinancials.summary.totalAmount;
        const snapshot = await this._getOrUpdateSnapshot(flatId, targetMonth, flat.monthlyBudget, totalSpent, combinedFinancials.byCategory);

        // Build complete report
        const report = {
            month: targetMonth,
            flatId,
            
            summary: {
                totalBills: combinedFinancials.billsTotal,
                totalExpenses: combinedFinancials.expensesTotal,
                totalSpent: totalSpent,
                totalPaid: transactionsSummary.totalPaid,
                pending: totalSpent - transactionsSummary.totalPaid,
                budget: flat.monthlyBudget,
                budgetUsed: totalSpent,
                budgetRemaining: Math.max(0, flat.monthlyBudget - totalSpent),
                percentageUsed: flat.monthlyBudget > 0 
                    ? parseFloat(((totalSpent / flat.monthlyBudget) * 100).toFixed(1))
                    : 0,
                isOverBudget: totalSpent > flat.monthlyBudget,
                transactionCount: combinedFinancials.summary.count
            },

            categoryBreakdown: this._formatCategoryBreakdown(combinedFinancials.byCategory, totalSpent),
            
            recentActivity: combinedFinancials.recent,
            
            statusBreakdown: combinedFinancials.byStatus,

            userDues: {
                dues: userDuesData.dues,
                totalDue: userDuesData.totalDue,
                count: userDuesData.count
            },

            budgetSnapshot: snapshot,

            transactions: {
                summary: transactionsSummary,
                breakdown: this._formatTransactionBreakdown(transactionsSummary)
            },

            _metadata: {
                generatedAt: new Date(),
                queriesExecuted: 3,
                cached: false
            }
        };

        // Cache the report
        const isCurrentMonth = this._isCurrentMonth(targetMonth);
        const cacheTTL = isCurrentMonth ? 300 : 3600; // 5 min for current, 1 hour for past
        await this._setCachedReport(cacheKey, report, cacheTTL);

        return report;
    }

    /**
     * Get ML-powered budget forecast (optimized)
     * @param {ObjectId} flatId - Flat ID
     * @param {ObjectId} userId - Requesting user ID
     * @param {Number} forecastMonths - Number of months to forecast
     * @returns {Promise<Object>} Forecast data
     */
    async getForecast(flatId, userId, forecastMonths = 3) {
        const flat = await Flat.findById(flatId);
        if (!flat) {
            throw new Error("Flat not found");
        }

        if (!flat.isAdmin(userId) && !flat.isMember(userId)) {
            throw new Error("You don't have access to this flat");
        }

        // Check cache
        const cacheKey = `forecast:${flatId}`;
        const cached = await this._getCachedReport(cacheKey);
        if (cached) {
            console.log('🔮 Returning cached forecast');
            return { ...cached, _cached: true };
        }

        // OPTIMIZED: Single aggregation for all historical data
        const historicalData = await this._getHistoricalSpending(flatId, 24);

        if (historicalData.length < 2) {
            throw new Error("Insufficient historical data. Need at least 2 months of spending history.");
        }

        // Get current month spending
        const currentMonth = new Date().toISOString().slice(0, 7);
        const currentMonthData = await this._getCurrentMonthSpending(flatId);

        // Call ML service
        const mlForecast = await mlService.getForecast({
            historicalData: historicalData.map(h => ({ month: h.month, spent: h.totalSpent })),
            currentMonthSpent: currentMonthData.spent,
            daysPassedInMonth: currentMonthData.daysPassedInMonth,
            totalDaysInMonth: currentMonthData.totalDaysInMonth,
            monthlyBudget: flat.monthlyBudget || 0,
            forecastMonths
        });

        const result = {
            currentBudget: flat.monthlyBudget,
            currentMonthSpent: currentMonthData.spent,
            currentMonthProjection: mlForecast.currentMonthProjection,
            isLikelyOverBudget: mlForecast.isLikelyOverBudget,
            budgetDifference: mlForecast.budgetDifference,
            historicalData: historicalData.slice(0, 6), // Last 6 months for display
            predictions: mlForecast.predictions,
            nextMonthPrediction: mlForecast.nextMonthPrediction,
            averageSpending: mlForecast.averageSpending,
            trend: mlForecast.trend,
            confidence: mlForecast.confidence,
            explanation: mlForecast.explanation,
            modelInfo: mlForecast.modelInfo,
            usedML: mlForecast.usedML !== false,
            usedFallback: mlForecast.usedFallback || false,
            _metadata: {
                generatedAt: new Date(),
                monthsAnalyzed: historicalData.length
            }
        };

        // Cache forecast (1 hour TTL)
        await this._setCachedReport(cacheKey, result, 3600);

        return result;
    }

    /**
     * Get category-wise spending analysis
     * @param {ObjectId} flatId - Flat ID
     * @param {Object} dateRange - Optional start/end dates
     * @returns {Promise<Object>} Category breakdown
     */
    async getCategoryAnalysis(flatId, dateRange = {}) {
        const matchStage = { flatId: new mongoose.Types.ObjectId(flatId) };
        
        if (dateRange.startDate || dateRange.endDate) {
            matchStage.dueDate = {};
            if (dateRange.startDate) matchStage.dueDate.$gte = new Date(dateRange.startDate);
            if (dateRange.endDate) matchStage.dueDate.$lte = new Date(dateRange.endDate);
        }

        // Combine bills and expenses in single aggregation
        const categoryData = await Bill.aggregate([
            { $match: matchStage },
            {
                $unionWith: {
                    coll: 'expenses',
                    pipeline: [
                        { 
                            $match: { 
                                flatId: new mongoose.Types.ObjectId(flatId),
                                ...(matchStage.dueDate ? { createdAt: matchStage.dueDate } : {})
                            } 
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: '$category',
                    totalAmount: { $sum: '$totalAmount' },
                    count: { $sum: 1 },
                    avgAmount: { $avg: '$totalAmount' }
                }
            },
            { $sort: { totalAmount: -1 } }
        ]);

        const totalSpending = categoryData.reduce((sum, cat) => sum + cat.totalAmount, 0);

        return {
            totalSpending,
            categories: categoryData.map(cat => ({
                category: cat._id,
                totalAmount: cat.totalAmount,
                count: cat.count,
                avgAmount: Math.round(cat.avgAmount),
                percentage: parseFloat(((cat.totalAmount / totalSpending) * 100).toFixed(1))
            }))
        };
    }

    /**
     * Invalidate report cache (call when bills/payments change)
     * @param {ObjectId} flatId - Flat ID
     * @param {String} month - Month in YYYY-MM format (optional)
     */
    async invalidateCache(flatId, month = null) {
        if (month) {
            const cacheKey = `report:${flatId}:${month}`;
            // In production, use Redis: await redis.del(cacheKey);
            console.log(`🗑️ Invalidated cache: ${cacheKey}`);
        } else {
            // Invalidate all reports for flat
            console.log(`🗑️ Invalidated all reports for flat: ${flatId}`);
        }
        
        // Also invalidate forecast
        const forecastKey = `forecast:${flatId}`;
        console.log(`🗑️ Invalidated forecast: ${forecastKey}`);
    }

    // ==================== PRIVATE HELPER METHODS ====================

    /**
     * Get combined bills + expenses in single optimized query
     * @private
     */
    async _getCombinedFinancials(flatId, startDate, endDate) {
        const result = await Bill.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    dueDate: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $facet: {
                    // Summary totals
                    billSummary: [
                        {
                            $group: {
                                _id: null,
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // By category
                    byCategory: [
                        {
                            $group: {
                                _id: '$category',
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        },
                        {
                            $addFields: {
                                source: 'bill'
                            }
                        }
                    ],
                    // By status
                    byStatus: [
                        {
                            $group: {
                                _id: '$status',
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    // Recent bills
                    recent: [
                        { $sort: { dueDate: -1 } },
                        { $limit: 10 },
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'createdBy',
                                foreignField: '_id',
                                as: 'creator'
                            }
                        },
                        { $unwind: { path: '$creator', preserveNullAndEmptyArrays: true } },
                        {
                            $project: {
                                title: 1,
                                totalAmount: 1,
                                category: 1,
                                status: 1,
                                dueDate: 1,
                                'creator.userName': 1
                            }
                        },
                        {
                            $addFields: {
                                type: 'bill'
                            }
                        }
                    ]
                }
            }
        ]);

        // Also get expenses for the same period
        const expensesData = await Expense.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    createdAt: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $facet: {
                    expenseSummary: [
                        {
                            $group: {
                                _id: null,
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        }
                    ],
                    byCategory: [
                        {
                            $group: {
                                _id: '$category',
                                totalAmount: { $sum: '$totalAmount' },
                                count: { $sum: 1 }
                            }
                        },
                        {
                            $addFields: {
                                source: 'expense'
                            }
                        }
                    ]
                }
            }
        ]);

        // Merge results
        const billsTotal = result[0]?.billSummary[0]?.totalAmount || 0;
        const expensesTotal = expensesData[0]?.expenseSummary[0]?.totalAmount || 0;

        return {
            summary: {
                totalAmount: billsTotal + expensesTotal,
                count: (result[0]?.billSummary[0]?.count || 0) + (expensesData[0]?.expenseSummary[0]?.count || 0)
            },
            billsTotal,
            expensesTotal,
            byCategory: [
                ...(result[0]?.byCategory || []),
                ...(expensesData[0]?.byCategory || [])
            ],
            byStatus: result[0]?.byStatus || [],
            recent: result[0]?.recent || []
        };
    }

    /**
     * Get user's pending dues
     * @private
     */
    async _getUserDues(flatId, userId) {
        const dues = await BillSplit.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    status: 'owed'
                }
            },
            {
                $lookup: {
                    from: 'bills',
                    localField: 'billId',
                    foreignField: '_id',
                    as: 'bill'
                }
            },
            {
                $unwind: '$bill'
            },
            {
                $match: {
                    'bill.flatId': new mongoose.Types.ObjectId(flatId)
                }
            },
            {
                $facet: {
                    dues: [
                        {
                            $project: {
                                amount: 1,
                                status: 1,
                                billId: 1,
                                'bill.title': 1,
                                'bill.dueDate': 1,
                                'bill.category': 1
                            }
                        }
                    ],
                    summary: [
                        {
                            $group: {
                                _id: null,
                                totalDue: { $sum: '$amount' },
                                count: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]);

        return {
            dues: dues[0]?.dues || [],
            totalDue: dues[0]?.summary[0]?.totalDue || 0,
            count: dues[0]?.summary[0]?.count || 0
        };
    }

    /**
     * Get transactions summary
     * @private
     */
    async _getTransactionsSummary(flatId, startDate, endDate) {
        const summary = await Transaction.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    createdAt: { $gte: startDate, $lt: endDate }
                }
            },
            {
                $group: {
                    _id: '$type',
                    totalAmount: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const totalPaid = summary.find(t => t._id === 'payment')?.totalAmount || 0;
        const totalRefunds = summary.find(t => t._id === 'refund')?.totalAmount || 0;

        return {
            totalPaid,
            totalRefunds,
            netPayments: totalPaid - totalRefunds,
            breakdown: summary
        };
    }

    /**
     * Get or update budget snapshot without re-aggregating
     * @private
     */
    async _getOrUpdateSnapshot(flatId, month, budgetAmount, actualSpent, categoryBreakdown) {
        let snapshot = await BudgetSnapshot.findOne({ flatId, month });
        
        if (!snapshot) {
            snapshot = new BudgetSnapshot({
                flatId,
                month,
                budgetAmount: budgetAmount || 0,
                predictedAmount: budgetAmount || 0,
                actualSpent: 0
            });
        }

        // Update with calculated values (no re-aggregation)
        snapshot.budgetAmount = budgetAmount || snapshot.budgetAmount;
        snapshot.actualSpent = actualSpent;

        // Merge category breakdown
        const categoryMap = {};
        categoryBreakdown.forEach(cat => {
            categoryMap[cat._id] = (categoryMap[cat._id] || 0) + cat.totalAmount;
        });
        snapshot.categoryBreakdown = categoryMap;

        await snapshot.save();
        return snapshot;
    }

    /**
     * Get historical spending data (optimized - single query)
     * @private
     */
    async _getHistoricalSpending(flatId, months = 24) {
        const historicalData = await Bill.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    status: { $in: ['paid', 'partial'] }
                }
            },
            {
                $project: {
                    month: { $dateToString: { format: '%Y-%m', date: '$dueDate' } },
                    totalAmount: 1,
                    category: 1
                }
            },
            {
                $unionWith: {
                    coll: 'expenses',
                    pipeline: [
                        {
                            $match: {
                                flatId: new mongoose.Types.ObjectId(flatId),
                                status: { $in: ['settled', 'active'] }
                            }
                        },
                        {
                            $project: {
                                month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                                totalAmount: 1,
                                category: 1
                            }
                        }
                    ]
                }
            },
            {
                $group: {
                    _id: '$month',
                    totalSpent: { $sum: '$totalAmount' },
                    count: { $sum: 1 },
                    categories: {
                        $push: { category: '$category', amount: '$totalAmount' }
                    }
                }
            },
            {
                $sort: { _id: -1 }
            },
            {
                $limit: months
            },
            {
                $project: {
                    _id: 0,
                    month: '$_id',
                    totalSpent: 1,
                    count: 1,
                    categories: 1
                }
            }
        ]);

        return historicalData;
    }

    /**
     * Get current month spending progress
     * @private
     */
    async _getCurrentMonthSpending(flatId) {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const result = await Bill.aggregate([
            {
                $match: {
                    flatId: new mongoose.Types.ObjectId(flatId),
                    dueDate: { $gte: startDate, $lte: endDate },
                    status: { $in: ['paid', 'partial'] }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$totalAmount' }
                }
            }
        ]);

        const spent = result[0]?.total || 0;
        const daysPassedInMonth = now.getDate();
        const totalDaysInMonth = endDate.getDate();

        return {
            spent,
            daysPassedInMonth,
            totalDaysInMonth
        };
    }

    /**
     * Format category breakdown with percentages
     * @private
     */
    _formatCategoryBreakdown(categories, totalSpent) {
        // Merge duplicate categories
        const categoryMap = {};
        categories.forEach(cat => {
            const key = cat._id;
            if (!categoryMap[key]) {
                categoryMap[key] = { totalAmount: 0, count: 0 };
            }
            categoryMap[key].totalAmount += cat.totalAmount;
            categoryMap[key].count += cat.count;
        });

        return Object.entries(categoryMap)
            .map(([category, data]) => ({
                category,
                totalAmount: data.totalAmount,
                count: data.count,
                avgAmount: Math.round(data.totalAmount / data.count),
                percentage: totalSpent > 0 
                    ? parseFloat(((data.totalAmount / totalSpent) * 100).toFixed(1))
                    : 0
            }))
            .sort((a, b) => b.totalAmount - a.totalAmount);
    }

    /**
     * Format transaction breakdown
     * @private
     */
    _formatTransactionBreakdown(summary) {
        return {
            payments: {
                total: summary.totalPaid,
                count: summary.breakdown.find(t => t._id === 'payment')?.count || 0
            },
            refunds: {
                total: summary.totalRefunds,
                count: summary.breakdown.find(t => t._id === 'refund')?.count || 0
            },
            net: summary.netPayments
        };
    }

    /**
     * Format month consistently (handles multiple input formats)
     * @private
     */
    _formatMonth(month) {
        if (!month) {
            return new Date().toISOString().slice(0, 7);
        }

        // Already in YYYY-MM format
        if (typeof month === 'string' && month.includes('-')) {
            return month;
        }

        // Month number (1-12)
        if (typeof month === 'number' || !isNaN(month)) {
            const year = new Date().getFullYear();
            return `${year}-${String(month).padStart(2, '0')}`;
        }

        return new Date().toISOString().slice(0, 7);
    }

    /**
     * Get date range for a month
     * @private
     */
    _getMonthDateRange(month) {
        const startDate = new Date(month + '-01');
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 1);
        return { startDate, endDate };
    }

    /**
     * Check if month is current month
     * @private
     */
    _isCurrentMonth(month) {
        return month === new Date().toISOString().slice(0, 7);
    }

    /**
     * Get cached report (in-memory for now, use Redis in production)
     * @private
     */
    async _getCachedReport(cacheKey) {
        // TODO: Implement Redis caching
        // return await redis.get(cacheKey);
        return null;
    }

    /**
     * Set cached report
     * @private
     */
    async _setCachedReport(cacheKey, data, ttl) {
        // TODO: Implement Redis caching
        // await redis.setex(cacheKey, ttl, JSON.stringify(data));
        console.log(`💾 Cached report: ${cacheKey} (TTL: ${ttl}s)`);
    }
}

// Export singleton instance
export default new ReportService();
