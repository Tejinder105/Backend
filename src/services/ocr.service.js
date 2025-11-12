import Tesseract from 'tesseract.js';

/**
 * Extract text from image using OCR
 * @param {string} imagePath - Path to image file or URL
 * @returns {Promise<string>} - Extracted text
 */
export const extractTextFromImage = async (imagePath) => {
    try {
        const result = await Tesseract.recognize(imagePath, 'eng', {
            logger: info => console.log('OCR Progress:', info)
        });

        return result.data.text;
    } catch (error) {
        throw new Error(`OCR failed: ${error.message}`);
    }
};

/**
 * Parse bill information from extracted text
 * @param {string} text - Extracted text from bill image
 * @returns {Object} - Parsed bill information
 */
export const parseBillInfo = (text) => {
    const billInfo = {
        vendor: null,
        amount: null,
        date: null,
        category: 'other'
    };

    try {
        const textLower = text.toLowerCase();
        
        // Extract amount - Enhanced for Indian currency formats
        // Matches: Rs. 1,250.00 | ₹1250 | INR 1250.50 | Rs 1,250 | 1,250.00 Rs
        const amountPatterns = [
            /(?:rs\.?|inr|₹)\s*(\d+(?:[,]\d+)*(?:\.\d{2})?)/gi,
            /(\d+(?:[,]\d+)*(?:\.\d{2})?)\s*(?:rs\.?|inr|₹)/gi,
            /total\s*(?:amount)?:?\s*(?:rs\.?|inr|₹)?\s*(\d+(?:[,]\d+)*(?:\.\d{2})?)/gi,
            /amount\s*(?:due)?:?\s*(?:rs\.?|inr|₹)?\s*(\d+(?:[,]\d+)*(?:\.\d{2})?)/gi,
        ];
        
        let foundAmount = null;
        for (const pattern of amountPatterns) {
            const matches = text.matchAll(pattern);
            for (const match of matches) {
                const numericPart = match[1];
                if (numericPart) {
                    const cleanedAmount = parseFloat(numericPart.replace(/,/g, ''));
                    // Take the largest reasonable amount (between 1 and 1,000,000)
                    if (cleanedAmount >= 1 && cleanedAmount <= 1000000) {
                        if (!foundAmount || cleanedAmount > foundAmount) {
                            foundAmount = cleanedAmount;
                        }
                    }
                }
            }
        }
        billInfo.amount = foundAmount;

        // Extract date - Multiple date formats
        const datePatterns = [
            /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/gi,
            /(\d{2,4}[-/]\d{1,2}[-/]\d{1,2})/gi,
            /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/gi,
            /(?:date|dated):?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/gi,
        ];
        
        for (const pattern of datePatterns) {
            const dateMatch = text.match(pattern);
            if (dateMatch) {
                try {
                    const parsedDate = new Date(dateMatch[0]);
                    if (!isNaN(parsedDate.getTime())) {
                        billInfo.date = parsedDate;
                        break;
                    }
                } catch (e) {
                    // Continue to next pattern
                }
            }
        }

        // Extract vendor - First meaningful company/business name
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        const vendorPatterns = [
            /^([A-Z][A-Za-z\s&]+(?:Limited|Ltd|Pvt|Private|Company|Co\.|Corporation|Corp|Electric|Electricity|Power|Water|Gas))/i,
            /^([A-Z][A-Za-z\s&]{3,50})/,
        ];
        
        for (const line of lines.slice(0, 5)) { // Check first 5 lines
            const trimmedLine = line.trim();
            if (trimmedLine.length < 3 || /^\d+$/.test(trimmedLine)) continue;
            
            for (const pattern of vendorPatterns) {
                const vendorMatch = trimmedLine.match(pattern);
                if (vendorMatch) {
                    billInfo.vendor = vendorMatch[1].trim().substring(0, 100);
                    break;
                }
            }
            if (billInfo.vendor) break;
        }
        
        // If no pattern matched, take first substantial line
        if (!billInfo.vendor) {
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.length > 5 && trimmed.length < 100 && !/^\d+$/.test(trimmed)) {
                    billInfo.vendor = trimmed;
                    break;
                }
            }
        }

        // Detect category based on keywords (enhanced)
        const categoryKeywords = {
            utilities: ['electricity', 'electric', 'power', 'current', 'utility', 'water', 'sewage', 'gas', 'lpg'],
            internet: ['internet', 'broadband', 'wifi', 'wi-fi', 'network', 'telecom', 'isp'],
            rent: ['rent', 'rental', 'lease', 'tenancy'],
            groceries: ['grocery', 'groceries', 'supermarket', 'mart', 'store', 'provisions'],
            maintenance: ['maintenance', 'repair', 'plumbing', 'carpentry', 'painting'],
            cleaning: ['cleaning', 'housekeeping', 'sanitization'],
        };
        
        for (const [category, keywords] of Object.entries(categoryKeywords)) {
            if (keywords.some(keyword => textLower.includes(keyword))) {
                billInfo.category = category;
                break;
            }
        }

    } catch (error) {
        console.error('Error parsing bill info:', error);
    }

    return billInfo;
};

/**
 * Process bill image and extract information
 * @param {string} imagePath - Path to bill image or URL
 * @returns {Promise<Object>} - Parsed bill information
 */
export const processBillImage = async (imagePath) => {
    try {
        console.log('🔍 Starting OCR on image:', imagePath);
        
        // Extract text from image
        const text = await extractTextFromImage(imagePath);
        
        console.log('📄 Extracted text length:', text?.length || 0);
        console.log('📝 Text preview:', text?.substring(0, 200));
        
        if (!text || text.trim().length === 0) {
            console.warn('⚠️ No text extracted from image');
            return {
                success: true,
                rawText: '',
                parsedData: {
                    vendor: null,
                    amount: null,
                    date: null,
                    category: 'other'
                }
            };
        }
        
        // Parse bill information
        const billInfo = parseBillInfo(text);
        
        console.log('✅ Parsed bill info:', billInfo);
        
        return {
            success: true,
            rawText: text,
            parsedData: billInfo
        };
    } catch (error) {
        console.error('❌ OCR processing error:', error);
        return {
            success: false,
            error: error.message,
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
