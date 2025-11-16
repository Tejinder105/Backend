import mongoose, { Schema } from "mongoose";

const budgetSnapshotSchema = new Schema(
    {
        flatId: {
            type: Schema.Types.ObjectId,
            ref: "Flat",
            required: true,
            index: true
        },
        month: {
            type: String,
            required: true, // Format: 'YYYY-MM'
            match: /^\d{4}-\d{2}$/
        },
        budgetAmount: {
            type: Number,
            required: true,
            min: 0
        },
        predictedAmount: {
            type: Number,
            default: 0,
            min: 0
        },
        actualSpent: {
            type: Number,
            default: 0,
            min: 0
        },
        categoryBreakdown: {
            rent: { type: Number, default: 0 },
            utilities: { type: Number, default: 0 },
            internet: { type: Number, default: 0 },
            groceries: { type: Number, default: 0 },
            cleaning: { type: Number, default: 0 },
            maintenance: { type: Number, default: 0 },
            furniture: { type: Number, default: 0 },
            other: { type: Number, default: 0 }
        },
        notes: {
            type: String,
            trim: true,
            maxlength: 1000
        }
    },
    {
        timestamps: true
    }
);

// Compound index to ensure uniqueness per flat per month
budgetSnapshotSchema.index({ flatId: 1, month: 1 }, { unique: true });

// Virtual to calculate variance
budgetSnapshotSchema.virtual('variance').get(function() {
    return this.budgetAmount - this.actualSpent;
});

// Virtual to calculate variance percentage
budgetSnapshotSchema.virtual('variancePercentage').get(function() {
    if (this.budgetAmount === 0) return 0;
    return ((this.budgetAmount - this.actualSpent) / this.budgetAmount) * 100;
});

// Method to update actual spent
budgetSnapshotSchema.methods.updateActualSpent = async function() {
    // DEPRECATED: This method is kept for backward compatibility
    // but should NOT be used in optimized code paths.
    // Use reportService.getCompleteFinancialReport() instead which calculates
    // actualSpent efficiently without redundant aggregations.
    
    console.warn('⚠️ DEPRECATED: updateActualSpent() called. Use reportService for optimized queries.');
    
    const Bill = mongoose.model('Bill');
    const startDate = new Date(this.month + '-01');
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const bills = await Bill.aggregate([
        {
            $match: {
                flatId: this.flatId,
                createdAt: { $gte: startDate, $lt: endDate },
                status: { $in: ['paid', 'partial'] }
            }
        },
        {
            $group: {
                _id: '$category',
                total: { $sum: '$totalAmount' }
            }
        }
    ]);

    // Reset category breakdown
    this.categoryBreakdown = {
        rent: 0,
        utilities: 0,
        internet: 0,
        groceries: 0,
        cleaning: 0,
        maintenance: 0,
        furniture: 0,
        other: 0
    };

    let total = 0;
    bills.forEach(bill => {
        if (this.categoryBreakdown.hasOwnProperty(bill._id)) {
            this.categoryBreakdown[bill._id] = bill.total;
        }
        total += bill.total;
    });

    this.actualSpent = total;
    await this.save();
};

// Static method to get or create snapshot for a month
budgetSnapshotSchema.statics.getOrCreate = async function(flatId, month, budgetAmount) {
    let snapshot = await this.findOne({ flatId, month });
    
    if (!snapshot) {
        snapshot = await this.create({
            flatId,
            month,
            budgetAmount,
            predictedAmount: budgetAmount,
            actualSpent: 0
        });
    }

    return snapshot;
};

// Static method to get current month's snapshot
budgetSnapshotSchema.statics.getCurrentMonthSnapshot = async function(flatId) {
    const currentMonth = new Date().toISOString().slice(0, 7); // Format: YYYY-MM
    
    let snapshot = await this.findOne({ flatId, month: currentMonth });
    
    // If no snapshot exists for current month, try to create one
    if (!snapshot) {
        const Flat = mongoose.model('Flat');
        const flat = await Flat.findById(flatId);
        
        if (flat && flat.monthlyBudget > 0) {
            snapshot = await this.getOrCreate(flatId, currentMonth, flat.monthlyBudget);
        }
    }
    
    return snapshot;
};

export const BudgetSnapshot = mongoose.model("BudgetSnapshot", budgetSnapshotSchema);
