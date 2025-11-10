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
        // Extract amount (looks for currency symbols and numbers)
        const amountRegex = /(?:Rs\.?|INR|₹)\s*(\d+(?:,\d+)*(?:\.\d{2})?)|(\d+(?:,\d+)*(?:\.\d{2})?)\s*(?:Rs\.?|INR|₹)/gi;
        const amountMatch = text.match(amountRegex);
        
        if (amountMatch) {
            // Extract numeric value
            const numericMatch = amountMatch[0].match(/\d+(?:,\d+)*(?:\.\d{2})?/);
            if (numericMatch) {
                billInfo.amount = parseFloat(numericMatch[0].replace(/,/g, ''));
            }
        }

        // Extract date (looks for date patterns)
        const dateRegex = /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})|(\d{2,4}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/gi;
        const dateMatch = text.match(dateRegex);
        
        if (dateMatch) {
            try {
                billInfo.date = new Date(dateMatch[0]);
                if (isNaN(billInfo.date.getTime())) {
                    billInfo.date = null;
                }
            } catch (e) {
                billInfo.date = null;
            }
        }

        // Extract vendor (first line or words before amount)
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 0) {
            // Take first meaningful line (longer than 3 chars)
            for (const line of lines) {
                if (line.trim().length > 3 && !line.match(/^\d+$/)) {
                    billInfo.vendor = line.trim().substring(0, 100);
                    break;
                }
            }
        }

        // Detect category based on keywords
        const textLower = text.toLowerCase();
        if (textLower.includes('electricity') || textLower.includes('power') || textLower.includes('electric')) {
            billInfo.category = 'utilities';
        } else if (textLower.includes('internet') || textLower.includes('broadband') || textLower.includes('wifi')) {
            billInfo.category = 'internet';
        } else if (textLower.includes('water') || textLower.includes('gas')) {
            billInfo.category = 'utilities';
        } else if (textLower.includes('rent') || textLower.includes('rental')) {
            billInfo.category = 'rent';
        } else if (textLower.includes('grocery') || textLower.includes('supermarket') || textLower.includes('mart')) {
            billInfo.category = 'groceries';
        } else if (textLower.includes('cleaning') || textLower.includes('housekeeping')) {
            billInfo.category = 'cleaning';
        } else if (textLower.includes('maintenance') || textLower.includes('repair')) {
            billInfo.category = 'maintenance';
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
        // Extract text from image
        const text = await extractTextFromImage(imagePath);
        
        // Parse bill information
        const billInfo = parseBillInfo(text);
        
        return {
            success: true,
            rawText: text,
            parsedData: billInfo
        };
    } catch (error) {
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
