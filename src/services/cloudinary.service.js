import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload file to Cloudinary
 * @param {string} localFilePath - Path to local file
 * @param {string} folder - Cloudinary folder name
 * @returns {Promise<Object>} - Upload result with URL
 */
export const uploadToCloudinary = async (localFilePath, folder = 'smartrent') => {
    try {
        if (!localFilePath) {
            throw new Error('File path is required');
        }

        // Upload file to Cloudinary
        const response = await cloudinary.uploader.upload(localFilePath, {
            folder: folder,
            resource_type: 'auto',
            transformation: [
                { width: 1000, crop: 'limit' },
                { quality: 'auto:good' }
            ]
        });

        // Delete local file after upload
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }

        return {
            url: response.secure_url,
            publicId: response.public_id,
            format: response.format,
            width: response.width,
            height: response.height
        };
    } catch (error) {
        // Delete local file if upload fails
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        throw new Error(`Cloudinary upload failed: ${error.message}`);
    }
};

/**
 * Upload avatar to Cloudinary
 * @param {string} localFilePath - Path to avatar file
 * @returns {Promise<string>} - Avatar URL
 */
export const uploadAvatar = async (localFilePath) => {
    try {
        const result = await cloudinary.uploader.upload(localFilePath, {
            folder: 'smartrent/avatars',
            transformation: [
                { width: 200, height: 200, crop: 'fill', gravity: 'face' },
                { quality: 'auto:good' }
            ]
        });

        // Delete local file
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }

        return result.secure_url;
    } catch (error) {
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        throw new Error(`Avatar upload failed: ${error.message}`);
    }
};

/**
 * Upload bill image to Cloudinary
 * @param {string} localFilePath - Path to bill image
 * @returns {Promise<string>} - Bill image URL
 */
export const uploadBillImage = async (localFilePath) => {
    try {
        const result = await cloudinary.uploader.upload(localFilePath, {
            folder: 'smartrent/bills',
            transformation: [
                { width: 1200, crop: 'limit' },
                { quality: 'auto:good' }
            ]
        });

        // Delete local file
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }

        return result.secure_url;
    } catch (error) {
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        throw new Error(`Bill image upload failed: ${error.message}`);
    }
};

/**
 * Delete file from Cloudinary
 * @param {string} publicId - Cloudinary public ID
 * @returns {Promise<Object>} - Deletion result
 */
export const deleteFromCloudinary = async (publicId) => {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result;
    } catch (error) {
        throw new Error(`Cloudinary deletion failed: ${error.message}`);
    }
};

export default cloudinary;
