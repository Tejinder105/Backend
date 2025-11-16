import Joi from 'joi';

// User validation schemas
export const registerUserSchema = Joi.object({
    userName: Joi.string().min(3).max(30).required().trim().lowercase(),
    email: Joi.string().email().required().trim().lowercase(),
    password: Joi.string().min(6).required(),
    phone: Joi.string().pattern(/^[0-9]{10,15}$/).optional().allow(null, '')
});

export const loginUserSchema = Joi.object({
    email: Joi.string().email().required().trim().lowercase(),
    password: Joi.string().required()
});

export const updateUserSchema = Joi.object({
    userName: Joi.string().min(3).max(30).optional().trim().lowercase(),
    phone: Joi.string().pattern(/^[0-9]{10,15}$/).optional().allow(null, ''),
    avatarUrl: Joi.string().uri().optional().allow(null, '')
});

// Flat validation schemas
export const createFlatSchema = Joi.object({
    name: Joi.string().min(3).max(100).required().trim(),
    rent: Joi.number().min(0).required(),
    address: Joi.object({
        street: Joi.string().optional().allow(null, ''),
        city: Joi.string().optional().allow(null, ''),
        state: Joi.string().optional().allow(null, ''),
        zipCode: Joi.string().optional().allow(null, ''),
        country: Joi.string().optional().default('India')
    }).optional(),
    currency: Joi.string().length(3).uppercase().default('INR'),
    monthlyBudget: Joi.number().min(0).default(0)
});

export const joinFlatSchema = Joi.object({
    joinCode: Joi.string().length(6).required().uppercase()
});

export const updateFlatSchema = Joi.object({
    name: Joi.string().min(3).max(100).optional().trim(),
    address: Joi.object({
        street: Joi.string().optional().allow(null, ''),
        city: Joi.string().optional().allow(null, ''),
        state: Joi.string().optional().allow(null, ''),
        zipCode: Joi.string().optional().allow(null, ''),
        country: Joi.string().optional()
    }).optional(),
    rent: Joi.number().min(0).optional(),
    settings: Joi.object().optional(),
    monthlyBudget: Joi.number().min(0).optional()
});

// Bill validation schemas
export const createBillSchema = Joi.object({
    title: Joi.string().min(3).max(200).required().trim(),
    vendor: Joi.string().max(100).optional().allow(null, '').trim(),
    totalAmount: Joi.number().min(0).required(),
    dueDate: Joi.date().required(),
    category: Joi.string().valid('rent', 'utilities', 'internet', 'groceries', 'cleaning', 'maintenance', 'furniture', 'other').default('other'),
    notes: Joi.string().max(1000).optional().allow(null, '').trim(),
    isRecurring: Joi.boolean().default(false),
    recurrenceRule: Joi.object({
        frequency: Joi.string().valid('daily', 'weekly', 'monthly', 'yearly').default('monthly'),
        interval: Joi.number().min(1).default(1),
        endDate: Joi.date().optional().allow(null)
    }).optional(),
    splitMethod: Joi.string().valid('equal', 'custom').default('equal'),
    participants: Joi.array().items(
        Joi.object({
            userId: Joi.string().required(),
            amount: Joi.number().min(0).when('$splitMethod', {
                is: 'custom',
                then: Joi.required(),
                otherwise: Joi.optional()
            })
        })
    ).min(1).required()
});

export const updateBillSchema = Joi.object({
    title: Joi.string().min(3).max(200).optional().trim(),
    vendor: Joi.string().max(100).optional().allow(null, '').trim(),
    totalAmount: Joi.number().min(0).optional(),
    dueDate: Joi.date().optional(),
    category: Joi.string().valid('rent', 'utilities', 'internet', 'groceries', 'cleaning', 'maintenance', 'furniture', 'other').optional(),
    notes: Joi.string().max(1000).optional().allow(null, '').trim()
});

// Transaction validation schemas
export const createTransactionSchema = Joi.object({
    type: Joi.string().valid('payment', 'refund', 'adjustment').required(),
    amount: Joi.number().min(0).required(),
    toUserId: Joi.string().optional().allow(null),
    billId: Joi.string().optional().allow(null),
    note: Joi.string().max(500).optional().allow(null, '').trim(),
    paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'upi', 'other').default('other'),
    transactionReference: Joi.string().optional().allow(null, '').trim()
});

export const payDuesSchema = Joi.object({
    billSplitIds: Joi.array().items(Joi.string()).min(1).required(),
    paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'upi', 'other').default('other'),
    transactionReference: Joi.string().optional().allow(null, '').trim(),
    note: Joi.string().max(500).optional().allow(null, '').trim()
});

// Budget validation schemas
export const setBudgetSchema = Joi.object({
    monthlyBudget: Joi.number().min(0).required()
});

export const forecastBudgetSchema = Joi.object({
    months: Joi.number().min(1).max(12).default(3)
});

// Unified Expense validation schemas
export const createExpenseSchema = Joi.object({
    flatId: Joi.string().required(),
    type: Joi.string().valid('shared', 'split').default('shared'),
    title: Joi.string().min(3).max(200).required().trim(),
    description: Joi.string().max(1000).optional().allow(null, '').trim(),
    vendor: Joi.string().max(100).optional().allow(null, '').trim(),
    totalAmount: Joi.number().min(0).required(),
    dueDate: Joi.date().when('type', {
        is: 'shared',
        then: Joi.required(),
        otherwise: Joi.optional()
    }),
    category: Joi.string().valid('rent', 'utilities', 'internet', 'groceries', 'cleaning', 'maintenance', 'furniture', 'other').default('other'),
    splitMethod: Joi.string().valid('equal', 'custom').default('equal'),
    participants: Joi.array().items(
        Joi.object({
            userId: Joi.string().required(),
            name: Joi.string().optional(),
            amount: Joi.number().min(0).when('$splitMethod', {
                is: 'custom',
                then: Joi.required(),
                otherwise: Joi.optional()
            })
        })
    ).min(1).required(),
    notes: Joi.string().max(1000).optional().allow(null, '').trim(),
    isRecurring: Joi.boolean().default(false),
    recurrenceRule: Joi.object({
        frequency: Joi.string().valid('daily', 'weekly', 'monthly', 'yearly').default('monthly'),
        interval: Joi.number().min(1).default(1),
        endDate: Joi.date().optional().allow(null)
    }).optional(),
    imageUrl: Joi.string().uri().optional().allow(null, '')
});

export const recordPaymentSchema = Joi.object({
    expenseType: Joi.string().valid('bill', 'expense').required(),
    expenseId: Joi.string().when('expenseType', {
        is: 'expense',
        then: Joi.string().required(),
        otherwise: Joi.optional()
    }),
    billSplitIds: Joi.array().items(Joi.string()).when('expenseType', {
        is: 'bill',
        then: Joi.array().items(Joi.string()).min(1).required(),
        otherwise: Joi.optional()
    }),
    participantUserId: Joi.string().when('expenseType', {
        is: 'expense',
        then: Joi.string().required(),
        otherwise: Joi.optional()
    }),
    paymentMethod: Joi.string().valid('cash', 'card', 'bank_transfer', 'upi', 'other').default('other'),
    transactionReference: Joi.string().optional().allow(null, '').trim(),
    note: Joi.string().max(500).optional().allow(null, '').trim()
});

// Validation middleware
export const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
            }));

            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors
            });
        }

        req.body = value;
        next();
    };
};
