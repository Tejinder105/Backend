import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

/**
 * Preprocess image for better OCR accuracy
 * @param {string} imagePath - Path to the original image
 * @returns {Promise<string>} - Path to preprocessed image
 */
const preprocessImage = async (imagePath) => {
    try {
        const preprocessedPath = imagePath.replace(/(\.\w+)$/, '_processed$1');
        
        await sharp(imagePath)
            .greyscale() // Convert to grayscale
            .normalize() // Normalize contrast
            .sharpen() // Sharpen edges
            .threshold(128) // Binary thresholding
            .median(3) // Remove noise
            .resize(null, 2000, { // Upscale if too small
                fit: 'inside',
                withoutEnlargement: false
            })
            .toFile(preprocessedPath);
        
        return preprocessedPath;
    } catch (error) {
        console.error('Image preprocessing failed:', error.message);
        // Return original if preprocessing fails
        return imagePath;
    }
};

/**
 * Extract text from image using OCR with optimized config
 * @param {string} imagePath - Path to image file
 * @returns {Promise<Object>} - OCR result with text and confidence
 */
const extractTextFromImage = async (imagePath) => {
    try {
        // Preprocess image first
        const processedPath = await preprocessImage(imagePath);
        
        const result = await Tesseract.recognize(
            processedPath,
            'eng',
            {
                logger: () => {}, // Suppress verbose logging
                tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
                tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,-:/()₹$@ \n'
            }
        );

        // Cleanup preprocessed file
        if (processedPath !== imagePath) {
            try {
                await fs.unlink(processedPath);
            } catch (err) {
                // Ignore cleanup errors
            }
        }

        return {
            text: result.data.text,
            confidence: result.data.confidence
        };
    } catch (error) {
        throw new Error(`OCR extraction failed: ${error.message}`);
    }
};

/**
 * Extract vendor/store name from text
 * @param {string[]} lines - Text lines
 * @returns {string|null} - Vendor name
 */
const extractVendor = (lines) => {
    // Look in first 10 lines for business name
    const vendorPatterns = [
        /^([A-Z][A-Za-z\s&.,']+(?:Ltd|Limited|Pvt|Private|Inc|Corporation|Corp|Company|Co\.|Store|Mart|Market|Shop))/i,
        /^([A-Z][A-Za-z\s&.,']{5,50})/
    ];
    
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i].trim();
        
        // Skip very short lines, numbers, or addresses
        if (line.length < 3 || /^\d+$/.test(line) || /^\d+[\s,]/.test(line)) {
            continue;
        }
        
        for (const pattern of vendorPatterns) {
            const match = line.match(pattern);
            if (match) {
                return match[1].trim().substring(0, 100);
            }
        }
    }
    
    // Fallback: return first substantial line
    for (const line of lines.slice(0, 5)) {
        const trimmed = line.trim();
        if (trimmed.length > 5 && trimmed.length < 100 && !/^\d/.test(trimmed)) {
            return trimmed;
        }
    }
    
    return null;
};

/**
 * Extract date from text
 * @param {string} text - Full text
 * @returns {string|null} - Date in ISO format
 */
const extractDate = (text) => {
    const datePatterns = [
        // dd/mm/yyyy, dd-mm-yyyy
        /(?:date|dated|bill date|invoice date)[:\s]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i,
        /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/,
        // yyyy-mm-dd
        /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,
        // dd Mon yyyy
        /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/i,
        // Mon dd, yyyy
        /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i
    ];
    
    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            const dateStr = match[1] || match[0];
            try {
                const date = new Date(dateStr);
                if (!isNaN(date.getTime()) && date.getFullYear() > 2000 && date.getFullYear() < 2100) {
                    return date.toISOString().split('T')[0];
                }
            } catch (e) {
                continue;
            }
        }
    }
    
    return null;
};

/**
 * Extract invoice/bill number
 * @param {string} text - Full text
 * @returns {string|null} - Invoice number
 */
const extractInvoiceNumber = (text) => {
    const patterns = [
        /(?:invoice|bill|receipt|ref|reference|no|number|#)[:\s]*([A-Z0-9-]+)/i,
        /(?:inv|rcpt|bill)[:\s]*([A-Z0-9-]+)/i,
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].length > 2) {
            return match[1].trim();
        }
    }
    
    return null;
};

/**
 * Extract amount from text with currency handling
 * @param {string} text - Text to search
 * @param {RegExp} pattern - Pattern to match
 * @returns {number|null} - Extracted amount
 */
const extractAmount = (text, pattern) => {
    const matches = [...text.matchAll(pattern)];
    
    for (const match of matches) {
        const numStr = match[1] || match[2];
        if (numStr) {
            const cleaned = numStr.replace(/[,\s]/g, '');
            const amount = parseFloat(cleaned);
            
            if (!isNaN(amount) && amount > 0 && amount < 10000000) {
                return Math.round(amount * 100) / 100;
            }
        }
    }
    
    return null;
};

/**
 * Extract total amount
 * @param {string} text - Full text
 * @returns {number|null} - Total amount
 */
const extractTotal = (text) => {
    const totalPatterns = [
        /(?:total|grand total|net total|amount payable|total amount|amount due|balance due|net amount)[:\s]*(?:rs\.?|inr|₹|\$)?\s*([0-9,]+\.?\d{0,2})/gi,
        /(?:rs\.?|inr|₹|\$)\s*([0-9,]+\.?\d{0,2})\s*(?:total|grand total|net)/gi,
        /(?:total|grand total)[:\s]*([0-9,]+\.?\d{0,2})/gi
    ];
    
    for (const pattern of totalPatterns) {
        const amount = extractAmount(text, pattern);
        if (amount !== null) {
            return amount;
        }
    }
    
    // Fallback: find largest amount in text
    const allAmounts = [...text.matchAll(/(?:rs\.?|inr|₹|\$)\s*([0-9,]+\.?\d{0,2})/gi)];
    let maxAmount = 0;
    
    for (const match of allAmounts) {
        const cleaned = match[1].replace(/,/g, '');
        const amount = parseFloat(cleaned);
        if (!isNaN(amount) && amount > maxAmount && amount < 10000000) {
            maxAmount = amount;
        }
    }
    
    return maxAmount > 0 ? Math.round(maxAmount * 100) / 100 : null;
};

/**
 * Extract tax amount
 * @param {string} text - Full text
 * @returns {number|null} - Tax amount
 */
const extractTax = (text) => {
    const taxPatterns = [
        /(?:tax|gst|vat|cgst|sgst|igst|sales tax)[:\s]*(?:rs\.?|inr|₹|\$)?\s*([0-9,]+\.?\d{0,2})/gi,
        /(?:rs\.?|inr|₹|\$)\s*([0-9,]+\.?\d{0,2})\s*(?:tax|gst)/gi
    ];
    
    for (const pattern of taxPatterns) {
        const amount = extractAmount(text, pattern);
        if (amount !== null) {
            return amount;
        }
    }
    
    return null;
};

/**
 * Extract subtotal amount
 * @param {string} text - Full text
 * @returns {number|null} - Subtotal amount
 */
const extractSubtotal = (text) => {
    const subtotalPatterns = [
        /(?:sub total|subtotal|sub-total|sub)[:\s]*(?:rs\.?|inr|₹|\$)?\s*([0-9,]+\.?\d{0,2})/gi,
        /(?:rs\.?|inr|₹|\$)\s*([0-9,]+\.?\d{0,2})\s*(?:sub total|subtotal)/gi
    ];
    
    for (const pattern of subtotalPatterns) {
        const amount = extractAmount(text, pattern);
        if (amount !== null) {
            return amount;
        }
    }
    
    return null;
};

/**
 * Extract line items from receipt
 * @param {string} text - Full text
 * @returns {Array} - Array of items
 */
const extractLineItems = (text) => {
    const items = [];
    const lines = text.split('\n');
    
    // Look for item patterns: ITEM_NAME  QTY  PRICE  TOTAL
    const itemPatterns = [
        // Name  Qty  Price  Total
        /^(.+?)\s+(\d+(?:\.\d+)?)\s+(?:rs\.?|₹|\$)?\s*(\d+(?:,\d+)*(?:\.\d{2})?)\s+(?:rs\.?|₹|\$)?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        // Name  @Price  Qty  Total
        /^(.+?)\s+@\s*(?:rs\.?|₹|\$)?\s*(\d+(?:\.\d{2})?)\s+(\d+)\s+(?:rs\.?|₹|\$)?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
        // Name  Price x Qty  Total
        /^(.+?)\s+(?:rs\.?|₹|\$)?\s*(\d+(?:\.\d{2})?)\s*x\s*(\d+)\s+(?:rs\.?|₹|\$)?\s*(\d+(?:,\d+)*(?:\.\d{2})?)/i,
    ];
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip headers, empty lines, totals
        if (!trimmed || 
            /^(item|product|description|qty|quantity|price|amount|total|subtotal|tax|grand)/i.test(trimmed) ||
            trimmed.length < 5) {
            continue;
        }
        
        for (const pattern of itemPatterns) {
            const match = trimmed.match(pattern);
            if (match) {
                const [, name, qtyOrPrice, priceOrQty, total] = match;
                
                // Parse based on pattern
                let itemName, qty, price, itemTotal;
                
                if (pattern.source.includes('@')) {
                    // Pattern: Name @Price Qty Total
                    itemName = name.trim();
                    price = parseFloat(qtyOrPrice);
                    qty = parseInt(priceOrQty);
                    itemTotal = parseFloat(total.replace(/,/g, ''));
                } else if (pattern.source.includes('x')) {
                    // Pattern: Name Price x Qty Total
                    itemName = name.trim();
                    price = parseFloat(qtyOrPrice);
                    qty = parseInt(priceOrQty);
                    itemTotal = parseFloat(total.replace(/,/g, ''));
                } else {
                    // Pattern: Name Qty Price Total
                    itemName = name.trim();
                    qty = parseFloat(qtyOrPrice);
                    price = parseFloat(priceOrQty.replace(/,/g, ''));
                    itemTotal = parseFloat(total.replace(/,/g, ''));
                }
                
                // Validate
                if (itemName.length > 2 && qty > 0 && price > 0 && itemTotal > 0) {
                    items.push({
                        name: itemName.substring(0, 100),
                        qty: qty,
                        price: Math.round(price * 100) / 100,
                        total: Math.round(itemTotal * 100) / 100
                    });
                    break;
                }
            }
        }
    }
    
    return items;
};

/**
 * Parse bill information from extracted text
 * @param {string} text - Extracted text from bill image
 * @returns {Object} - Structured bill information
 */
export const parseBillInfo = (text) => {
    if (!text || text.trim().length === 0) {
        return {
            vendor: null,
            date: null,
            invoiceNumber: null,
            subtotal: null,
            tax: null,
            total: null,
            items: [],
            category: 'other'
        };
    }
    
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const textLower = text.toLowerCase();
    
    // Extract all fields
    const vendor = extractVendor(lines);
    const date = extractDate(text);
    const invoiceNumber = extractInvoiceNumber(text);
    const total = extractTotal(text);
    const tax = extractTax(text);
    const subtotal = extractSubtotal(text) || (total && tax ? total - tax : null);
    const items = extractLineItems(text);
    
    // Auto-detect category
    let category = 'other';
    const categoryKeywords = {
        utilities: ['electricity', 'electric', 'power', 'utility', 'water', 'gas', 'lpg', 'current'],
        internet: ['internet', 'broadband', 'wifi', 'wi-fi', 'telecom', 'network'],
        rent: ['rent', 'rental', 'lease', 'tenancy'],
        groceries: ['grocery', 'supermarket', 'mart', 'store', 'provisions', 'kirana'],
        maintenance: ['maintenance', 'repair', 'plumbing', 'carpentry'],
        cleaning: ['cleaning', 'housekeeping', 'sanitization']
    };
    
    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            category = cat;
            break;
        }
    }
    
    return {
        vendor,
        date,
        invoiceNumber,
        subtotal,
        tax,
        total,
        items,
        category
    };
};

/**
 * Process bill image and extract structured information
 * @param {string} imagePath - Path to bill image
 * @returns {Promise<Object>} - Structured bill data with raw text
 */
export const processBillImage = async (imagePath) => {
    try {
        // Validate file exists
        try {
            await fs.access(imagePath);
        } catch (err) {
            throw new Error('Image file not found or inaccessible');
        }
        
        // Extract text with OCR
        const ocrResult = await extractTextFromImage(imagePath);
        
        if (!ocrResult.text || ocrResult.text.trim().length === 0) {
            return {
                success: false,
                error: 'No text could be extracted from the image',
                confidence: ocrResult.confidence || 0,
                rawText: '',
                parsedData: null
            };
        }
        
        // Parse bill information
        const billInfo = parseBillInfo(ocrResult.text);
        
        return {
            success: true,
            confidence: Math.round(ocrResult.confidence || 0),
            rawText: ocrResult.text,
            parsedData: billInfo
        };
    } catch (error) {
        console.error('OCR processing error:', error.message);
        return {
            success: false,
            error: error.message,
            confidence: 0,
            rawText: null,
            parsedData: null
        };
    }
};

export default {
    extractTextFromImage,
    parseBillInfo,
    processBillImage
};
