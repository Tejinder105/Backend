import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs/promises';

const preprocessImage = async (imagePath, strategy = 'default') => {
    try {
        const preprocessedPath = imagePath.replace(/(\.\w+)$/, `_${strategy}$1`);
        
        let pipeline = sharp(imagePath);
        
        switch (strategy) {
            case 'high-contrast':
                await pipeline
                    .greyscale()
                    .normalize()
                    .linear(1.8, -(128 * 0.8)) // Boost contrast
                    .threshold(140)
                    .resize(null, 2400, { fit: 'inside', withoutEnlargement: false })
                    .toFile(preprocessedPath);
                break;
            
            case 'sharp':
                await pipeline
                    .greyscale()
                    .sharpen({ sigma: 3 })
                    .normalize()
                    .threshold(125)
                    .resize(null, 2400, { fit: 'inside', withoutEnlargement: false })
                    .toFile(preprocessedPath);
                break;
            
            case 'clean':
                await pipeline
                    .greyscale()
                    .median(5)
                    .normalize()
                    .threshold(130)
                    .sharpen()
                    .resize(null, 2400, { fit: 'inside', withoutEnlargement: false })
                    .toFile(preprocessedPath);
                break;
            
            default:
                await pipeline
                    .greyscale()
                    .normalize()
                    .sharpen()
                    .threshold(128)
                    .median(3)
                    .resize(null, 2000, { fit: 'inside', withoutEnlargement: false })
                    .toFile(preprocessedPath);
        }
        
        return preprocessedPath;
    } catch (error) {
        console.error('Preprocessing failed:', error.message);
        return imagePath;
    }
};


const extractTextFromImage = async (imagePath, tryMultipleModes = false) => {
    try {
        const processedPath = await preprocessImage(imagePath);
        
        const modes = tryMultipleModes 
            ? [Tesseract.PSM.AUTO, Tesseract.PSM.SINGLE_BLOCK, Tesseract.PSM.SPARSE_TEXT]
            : [Tesseract.PSM.AUTO];
        
        let bestText = '';
        let bestConfidence = 0;
        
        for (const mode of modes) {
            try {
                const result = await Tesseract.recognize(processedPath, 'eng', {
                    logger: () => {},
                    tessedit_pageseg_mode: mode,
                    tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
                });
                
                if (result.data.text.length > bestText.length) {
                    bestText = result.data.text;
                    bestConfidence = result.data.confidence;
                }
            } catch (err) {
                console.log('Mode failed:', mode);
            }
        }

        if (processedPath !== imagePath) {
            try { await fs.unlink(processedPath); } catch (err) {}
        }

        return { text: bestText, confidence: bestConfidence };
    } catch (error) {
        throw new Error(`OCR extraction failed: ${error.message}`);
    }
};

const extractVendor = (lines) => {
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i].trim();
        if (line.length > 5 && line.length < 100 && !/^\d/.test(line)) {
            return line;
        }
    }
    return null;
};

const parseAmount = (numStr) => {
    if (!numStr) return null;
    
    let cleaned = numStr.replace(/[₹$€£]/g, '').trim();
    
        if (cleaned.includes('.') && cleaned.includes(',')) {
        const lastDot = cleaned.lastIndexOf('.');
        const lastComma = cleaned.lastIndexOf(',');
        
        if (lastComma > lastDot) {
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            cleaned = cleaned.replace(/,/g, '');
        }
    }
    else if (cleaned.split('.').length === 3) {

        cleaned = cleaned.replace(/\.(\d{3})\./, '$1.');
    }
    else if (cleaned.includes(',') && !cleaned.includes('.')) {
        cleaned = cleaned.replace(/,/g, '');
    }
    else if (cleaned.includes(' ')) {
        cleaned = cleaned.replace(/\s/g, '');
    }
    
    const num = parseFloat(cleaned);
    return (!isNaN(num) && num > 0) ? num : null;
};

const extractInvoiceNumber = (text) => {
    const patterns = [
        /invoice\s*#?\s*:?\s*([A-Z0-9\-]+)/i,
        /bill\s*#?\s*:?\s*([A-Z0-9\-]+)/i,
        /(?:rc|rct|rcf|ref)\s*#?\s*:?\s*([A-Z0-9\-]+)/i,
        /#\s*([A-Z]{2,}\d+[A-Z0-9\-]*)/,  // #HCAIN2425-329233
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1] && match[1].length > 2) {
            return match[1].trim();
        }
    }
    return null;
};


const debugOCRText = (text) => {
    console.log('\n🔍 [DEBUG] Raw OCR Text Analysis:');
    console.log('=' .repeat(80));
    
    const allNumbers = [...text.matchAll(/\d+(?:[,.\s]\d+)*/g)].map(m => m[0]);
    console.log('All numbers found:', allNumbers);
    
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        if (line.toLowerCase().includes('total')) {
            console.log(`Line ${i} (TOTAL):`, line);
            
            const patterns = [
                /total\s+(\d+)\.(\d{3})\s+(\d{2})/i,  
                /total\s+(\d+)\.(\d{3})\.(\d{2})/i,   
                /total\s+(\d+),(\d{3})\.(\d{2})/i,    
                /total\s+(\d+)\s+(\d{3})\.(\d{2})/i,
            ];
            
            for (const pattern of patterns) {
                const match = line.match(pattern);
                if (match) {
                    const amount = parseInt(match[1]) * 1000 + parseInt(match[2]) + parseInt(match[3]) / 100;
                    console.log(`  → Parsed as: ${amount}`);
                }
            }
        }
        if (line.toLowerCase().includes('igst') || line.toLowerCase().includes('sub')) {
            console.log(`Line ${i} (TAX/SUB):`, line);
        }
    });
    
    console.log('=' .repeat(80) + '\n');
};

const extractTotal = (text) => {
    if (!text) return null;

    console.log('\n🔍 [OCR] ===== EXTRACTING TOTAL (ADVANCED) =====');
    console.log('📄 [OCR] Text length:', text.length);
    console.log('📄 [OCR] Preview:\n', text.substring(0, 700));
    console.log('=' .repeat(80));

    const results = [];

    const lines = text.split('\n');
    const amountColumns = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const endAmountMatch = line.match(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)\s*$/);
        if (endAmountMatch) {
            const cleanAmount = endAmountMatch[1].replace(/[\s,]/g, ''); // Remove spaces AND commas
            const amount = parseFloat(cleanAmount);
            if (!isNaN(amount) && amount > 50) {
                amountColumns.push({ line: i, text: line, amount });
            }
        }
    }
    
    for (const { line, text, amount } of amountColumns) {
        if (text.toLowerCase().includes('total') && !text.toLowerCase().includes('sub')) {
            console.log('✓ [Strategy 1] Table format - Total line:', text);
            results.push({ strategy: 'Table Total', amount, confidence: 95 });
            break;
        }
    }

    for (const line of lines) {
        const specialPatterns = [
            { regex: /total\s+(\d+)\.(\d{3})\s+(\d{2})/i, name: 'Total (dot-space format)' },  // "Total 1.999 00"
            { regex: /total\s+(\d+)\.(\d{3})\.(\d{2})/i, name: 'Total (double-dot format)' },   // "Total 1.999.00"
            { regex: /total\s+(\d+),(\d{3})\.(\d{2})/i, name: 'Total (comma-dot format)' },    // "Total 1,999.00"
            { regex: /total\s+(\d+)\s+(\d{3})\.(\d{2})/i, name: 'Total (space format)' },  // "Total 1 999.00"
            { regex: /total\s+(\d+)\.(\d{3}),(\d{2})/i, name: 'Total (European format)' },    // "Total 1.999,00"
        ];
        
        for (const { regex, name } of specialPatterns) {
            const match = line.match(regex);
            if (match) {
                const amount = parseInt(match[1]) * 1000 + parseInt(match[2]) + parseInt(match[3]) / 100;
                console.log(`✓ [Strategy 2A] ${name}:`, amount, 'from:', line.trim());
                results.push({ strategy: name, amount, confidence: 96 });
                break;
            }
        }
        if (results.length > 0) break; 
    }
    
    const keywordPatterns = [
        { regex: /\btotal\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Total' },
        { regex: /\bnet\s+total\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Net Total' },
        { regex: /\bgrand\s+total\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Grand Total' },
        { regex: /\bfinal\s+(?:amount|total)\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Final Amount' },
        { regex: /\btotal\s+(?:amt|amount)\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Total Amount' },
        { regex: /\bamount\s+payable\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Amount Payable' },
        { regex: /\bpayable\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Payable' },
        { regex: /\bcollec\s+(?:cc|acd|rc)\s+amt\s*[:\-]?\s*₹?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'Collection Amount' },
    ];

    for (const { regex, name } of keywordPatterns) {
        const match = text.match(regex);
        if (match && match[1]) {
            const cleanAmount = match[1].replace(/[\s,]/g, '');
            const amount = parseFloat(cleanAmount);
            if (!isNaN(amount) && amount > 10) {
                console.log(`✓ [Strategy 2B] ${name} pattern:`, amount);
                results.push({ strategy: name, amount, confidence: 90 });
            }
        }
    }

    let subTotal = null;
    let igst = null, cgst = null, sgst = null;
    
    for (const line of lines) {
        const lower = line.toLowerCase();

        if (lower.includes('sub') && lower.includes('total')) {
            const amounts = [...line.matchAll(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/g)];
            if (amounts.length > 0) {
                const cleanAmount = amounts[amounts.length - 1][1].replace(/[\s,]/g, '');
                const amt = parseFloat(cleanAmount);
                if (amt > 50) subTotal = amt;
            }
        }

        if (lower.match(/\bigst\b.*\(18%\)|igst.*18/)) {
            const amounts = [...line.matchAll(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/g)];
            for (const match of amounts) {
                const cleanAmount = match[1].replace(/[\s,]/g, '');
                const amt = parseFloat(cleanAmount);
                if (amt > 10 && amt < 10000) igst = amt;
            }
        }

        if (lower.includes('cgst')) {
            const amounts = [...line.matchAll(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/g)];
            for (const match of amounts) {
                const cleanAmount = match[1].replace(/[\s,]/g, '');
                const amt = parseFloat(cleanAmount);
                if (amt > 5 && amt < 5000) cgst = amt;
            }
        }
        if (lower.includes('sgst')) {
            const amounts = [...line.matchAll(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/g)];
            for (const match of amounts) {
                const cleanAmount = match[1].replace(/[\s,]/g, '');
                const amt = parseFloat(cleanAmount);
                if (amt > 5 && amt < 5000) sgst = amt;
            }
        }
    }
    
    if (subTotal) {
        const gstTotal = (igst || 0) + (cgst || 0) + (sgst || 0);
        if (gstTotal > 0) {
            const calculated = subTotal + gstTotal;
            results.push({ strategy: 'GST Calculation', amount: calculated, confidence: 88 });
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lower = line.toLowerCase();
        
        if (lower.includes('total') && !lower.includes('sub')) {
            const combinedText = line + ' ' + (lines[i + 1] || '');
            const amounts = [...combinedText.matchAll(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/g)]
                .map(m => parseFloat(m[1].replace(/[\s,]/g, '')))
                .filter(n => n > 50 && n < 10000000);
            
            if (amounts.length > 0) {
                const maxAmount = Math.max(...amounts);
                results.push({ strategy: 'Total Line Context', amount: maxAmount, confidence: 85 });
            }
        }
    }
    const allAmounts = [...text.matchAll(/(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/g)]
        .map(m => parseFloat(m[1].replace(/[\s,]/g, '')))
        .filter(n => !isNaN(n) && n > 100 && n < 10000000);
    
    if (allAmounts.length > 0) {
        const sorted = allAmounts.sort((a, b) => b - a);
        console.log('✓ [Strategy 5] Top 5 amounts:', sorted.slice(0, 5));
        results.push({ strategy: 'Largest Amount', amount: sorted[0], confidence: 70 });
    }

    results.forEach(r => console.log(`  ${r.strategy}: ₹${r.amount} (confidence: ${r.confidence}%)`));
    
    if (results.length === 0) {
        console.log('❌ No total found!\n');
        return null;
    }

    // Sort by confidence, return highest
    results.sort((a, b) => b.confidence - a.confidence);
    const winner = results[0];
    
    console.log(`\n✅ FINAL RESULT: ₹${winner.amount} (${winner.strategy})`);
    console.log('=' .repeat(80) + '\n');
    
    return Math.round(winner.amount * 100) / 100;
};

/**
 * Extract date from bill text
 */
const extractDate = (text) => {
    if (!text) return null;
    
    console.log('🗓️ [OCR] Extracting date...');
    
    const datePatterns = [
        // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
        { regex: /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/, format: 'DMY' },
        // MM/DD/YYYY or MM-DD-YYYY
        { regex: /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/, format: 'MDY' },
        // DD Mon YYYY or DD Month YYYY (18 Nov 2025, 18 November 2025)
        { regex: /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i, format: 'DMY_TEXT' },
        // Mon DD, YYYY or Month DD, YYYY (Nov 18, 2025)
        { regex: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i, format: 'MDY_TEXT' },
        // Date: DD/MM/YYYY
        { regex: /date\s*[:\-]?\s*(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/i, format: 'DMY' },
        // YYYY-MM-DD (ISO format)
        { regex: /\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/, format: 'YMD' },
    ];
    
    const monthMap = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    
    for (const { regex, format } of datePatterns) {
        const match = text.match(regex);
        if (match) {
            try {
                let day, month, year;
                
                if (format === 'DMY') {
                    day = parseInt(match[1]);
                    month = parseInt(match[2]) - 1; // JS months are 0-indexed
                    year = parseInt(match[3]);
                } else if (format === 'MDY') {
                    month = parseInt(match[1]) - 1;
                    day = parseInt(match[2]);
                    year = parseInt(match[3]);
                } else if (format === 'YMD') {
                    year = parseInt(match[1]);
                    month = parseInt(match[2]) - 1;
                    day = parseInt(match[3]);
                } else if (format === 'DMY_TEXT') {
                    day = parseInt(match[1]);
                    month = monthMap[match[2].toLowerCase().substring(0, 3)];
                    year = parseInt(match[3]);
                } else if (format === 'MDY_TEXT') {
                    month = monthMap[match[1].toLowerCase().substring(0, 3)];
                    day = parseInt(match[2]);
                    year = parseInt(match[3]);
                }
                
                // Validate date
                if (day >= 1 && day <= 31 && month >= 0 && month <= 11 && year >= 2000 && year <= 2100) {
                    const date = new Date(year, month, day);
                    console.log(`✓ [OCR] Date found: ${date.toISOString().split('T')[0]} (${format})`);
                    return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
                }
            } catch (err) {
                console.log(`⚠️ [OCR] Date parsing error:`, err.message);
            }
        }
    }
    
    console.log('❌ [OCR] No valid date found');
    return null;
};

/**
 * Detect category from text
 */
const detectCategory = (text, vendor) => {
    const combined = (text + ' ' + (vendor || '')).toLowerCase();
    
    const categories = {
        utilities: ['electricity', 'power', 'water', 'gas'],
        internet: ['internet', 'broadband', 'wifi'],
        groceries: ['grocery', 'mart', 'kirana'],
        transport: ['taxi', 'cab', 'uber', 'ola']
    };
    
    for (const [cat, keywords] of Object.entries(categories)) {
        if (keywords.some(kw => combined.includes(kw))) return cat;
    }
    return 'other';
};

/**
 * Parse bill information with graceful error handling
 */
export const parseBillInfo = (text) => {
    if (!text) return { vendor: null, date: null, invoiceNumber: null, total: null, category: 'other' };
    
    // Debug: log raw text
    debugOCRText(text);
    
    const lines = text.split('\n').filter(l => l.trim());
    
    // Extract each field with try-catch for graceful degradation
    let vendor = null;
    try {
        vendor = extractVendor(lines);
    } catch (err) {
        console.log('⚠️ [OCR] Vendor extraction failed:', err.message);
    }
    
    let date = null;
    try {
        date = extractDate(text);
    } catch (err) {
        console.log('⚠️ [OCR] Date extraction failed:', err.message);
    }
    
    let invoiceNumber = null;
    try {
        invoiceNumber = extractInvoiceNumber(text);
    } catch (err) {
        console.log('⚠️ [OCR] Invoice number extraction failed:', err.message);
    }
    
    let total = null;
    try {
        total = extractTotal(text);
    } catch (err) {
        console.log('⚠️ [OCR] Total extraction failed:', err.message);
    }
    
    let category = 'other';
    try {
        category = detectCategory(text, vendor);
    } catch (err) {
        console.log('⚠️ [OCR] Category detection failed:', err.message);
    }
    
    console.log('📋 [OCR] Parsed:', { vendor, date, total, category });
    
    return { vendor, date, invoiceNumber, subtotal: null, tax: null, total, category };
};

/**
 * MULTI-PASS OCR Process - Try different strategies
 */
export const processBillImage = async (imagePath) => {
    try {
        await fs.access(imagePath);
        console.log('\n🤖 [OCR] ===== MULTI-PASS PROCESSING =====');
        console.log('📸 Image:', imagePath);
        console.log('=' .repeat(80));
        
        const strategies = ['default', 'high-contrast', 'sharp', 'clean'];
        let allResults = [];
        
        for (const strategy of strategies) {
            console.log(`\n🔄 [OCR] Trying ${strategy.toUpperCase()} preprocessing...`);
            
            try {
                // Preprocess with this strategy
                const processedPath = await preprocessImage(imagePath, strategy);
                
                // Extract text (try multiple modes for first two strategies)
                const ocrResult = await extractTextFromImage(processedPath, strategy === 'default' || strategy === 'high-contrast');
                
                // Clean up processed file
                if (processedPath !== imagePath) {
                    try { await fs.unlink(processedPath); } catch (err) {}
                }
                
                if (!ocrResult.text || ocrResult.text.trim().length < 50) {
                    console.log(`⚠️ [${strategy}] Insufficient text (${ocrResult.text.length} chars)`);
                    continue;
                }
                
                console.log(`✓ [${strategy}] Extracted ${ocrResult.text.length} chars, confidence: ${Math.round(ocrResult.confidence)}%`);
                
                // Parse this result
                const billInfo = parseBillInfo(ocrResult.text);
                
                // Calculate score
                let score = 0;
                if (billInfo.total && billInfo.total > 0) score += 50;
                if (billInfo.vendor && billInfo.vendor.length > 3) score += 20;
                if (billInfo.date) score += 15;
                if (billInfo.invoiceNumber) score += 10;
                if (ocrResult.text.length > 300) score += 5;
                
                allResults.push({
                    strategy,
                    score,
                    billInfo,
                    confidence: ocrResult.confidence,
                    text: ocrResult.text
                });
                
                console.log(`📊 [${strategy}] Score: ${score}/100`);
                console.log(`   Vendor: ${billInfo.vendor || 'N/A'}`);
                console.log(`   Total: ₹${billInfo.total || 'N/A'}`);
                console.log(`   Date: ${billInfo.date || 'N/A'}`);
                
                // If perfect score, stop early
                if (score >= 95) {
                    console.log(`🎯 [${strategy}] Perfect score! Stopping.`);
                    break;
                }
            } catch (err) {
                console.log(`❌ [${strategy}] Failed:`, err.message);
            }
        }
        
        if (allResults.length === 0) {
            console.log('\n❌ All strategies failed\n');
            return {
                success: false,
                error: 'No text extracted from any strategy',
                confidence: 0,
                rawText: '',
                parsedData: null
            };
        }
        
        // Pick best result
        allResults.sort((a, b) => b.score - a.score);
        const best = allResults[0];
        
        // Success if we have at least the amount (score >= 50)
        const isSuccessful = best.score >= 50 && best.billInfo.total > 0;
        
        console.log('\n' + '='.repeat(80));
        console.log(`🏆 [OCR] BEST RESULT: ${best.strategy.toUpperCase()} (Score: ${best.score}/100)`);
        console.log(`   Vendor: ${best.billInfo.vendor || 'Unknown'}`);
        console.log(`   Total: ₹${best.billInfo.total || 'Not found'}`);
        console.log(`   Date: ${best.billInfo.date || 'Not found'}`);
        console.log(`   Category: ${best.billInfo.category}`);
        console.log(`   Success: ${isSuccessful ? '✅ YES (Amount extracted)' : '❌ NO'}`);
        console.log('=' .repeat(80) + '\n');
        
        return {
            success: isSuccessful,
            confidence: Math.round(best.confidence || 0),
            rawText: best.text,
            parsedData: best.billInfo,
            ...(isSuccessful ? {} : { error: 'Failed to extract bill amount' })
        };
    } catch (error) {
        console.error('❌ [OCR] Fatal Error:', error.message);
        return {
            success: false,
            error: error.message,
            confidence: 0,
            rawText: null,
            parsedData: null
        };
    }
};

export default { extractTextFromImage, parseBillInfo, processBillImage };
