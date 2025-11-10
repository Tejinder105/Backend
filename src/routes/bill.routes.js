import { Router } from 'express';
import {
    createBill,
    getFlatBills,
    getBill,
    updateBill,
    deleteBill,
    scanBill,
    markBillPaid,
    getUserDues,
    upload
} from '../controllers/bill.controller.js';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { validate, createBillSchema, updateBillSchema } from '../Utils/validation.js';

const router = Router();

// Protect all routes
router.use(verifyJWT);

// Flat bills
router.post('/flats/:flatId/bills', validate(createBillSchema), createBill);
router.get('/flats/:flatId/bills', getFlatBills);

// User dues - MUST come before /:billId to avoid conflict
router.get('/dues', getUserDues); // Current user dues
router.get('/users/:userId/dues', getUserDues);

// Bill scanning (OCR)
router.post('/scan', upload.single('billImage'), scanBill);

// Single bill operations - MUST come after specific routes like /dues, /scan
router.get('/:billId', getBill);
router.put('/:billId', validate(updateBillSchema), updateBill);
router.delete('/:billId', deleteBill);

// Mark bill paid
router.post('/:billId/mark-paid', markBillPaid);

export default router;
