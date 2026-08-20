const axios = require('axios');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

/**
 * Validate image buffer magic bytes against common image file headers
 */
const validateMagicBytes = (buffer, reportedMime) => {
  if (!buffer || buffer.length < 4) {
    return false;
  }

  // JPEG / JPG: FF D8 FF
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  // PNG: 89 50 4E 47 (.PNG)
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;

  // GIF: 47 49 46 38 (GIF87a or GIF89a)
  const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;

  // WEBP: 52 49 46 46 ... 57 45 42 50 (RIFF....WEBP)
  const isWebp =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;

  if (isJpeg || isPng || isGif || isWebp) {
    return true;
  }

  // Reject buffer if magic bytes do not match safe image signatures
  return false;
};

/**
 * Upload an image file buffer to ImgBB
 *
 * @param {Object} params
 * @param {Buffer} params.buffer - File buffer from Multer
 * @param {string} params.originalname - Original filename
 * @param {string} params.mimetype - MIME type
 * @param {number} params.size - File size in bytes
 * @param {string} [params.name] - Custom name tag
 * @returns {Promise<Object>} Hosted image metadata
 */
const uploadImageToImgBB = async ({ buffer, originalname = 'image.png', mimetype = 'image/png', size = 0, name = '' }) => {
  // 1. Pre-validation checks
  if (!buffer || buffer.length === 0) {
    throw new ApiError(400, 'No image file provided or file is empty');
  }

  if (size > MAX_IMAGE_SIZE_BYTES || buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new ApiError(400, `File size exceeds the 5MB limit (Size: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`);
  }

  const normMime = (mimetype || '').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.includes(normMime)) {
    throw new ApiError(400, `Unsupported file format '${mimetype}'. Allowed formats: JPG, PNG, WEBP, GIF`);
  }

  if (!validateMagicBytes(buffer, normMime)) {
    throw new ApiError(400, 'Invalid or corrupted image file');
  }

  const apiKey = (process.env.IMGBB_API_KEY || '').replace(/['"]/g, '').trim();

  // 2. Mock Fallback when running in test mode or API key is unconfigured
  if (!apiKey || apiKey === 'YOUR_IMGBB_API_KEY' || process.env.NODE_ENV === 'test_mock') {
    logger.warn('[ImageUploadService] IMGBB_API_KEY is not configured or using placeholder. Returning mock hosted URL.');
    const mockId = Math.random().toString(36).substring(2, 10);
    return {
      url: `https://i.ibb.co/${mockId}/${originalname.replace(/\s+/g, '_')}`,
      displayUrl: `https://i.ibb.co/${mockId}/${originalname.replace(/\s+/g, '_')}`,
      thumbnailUrl: `https://i.ibb.co/${mockId}/thumb_${originalname.replace(/\s+/g, '_')}`,
      mediumUrl: `https://i.ibb.co/${mockId}/medium_${originalname.replace(/\s+/g, '_')}`,
      deleteUrl: `https://ibb.co/${mockId}/delete`,
      filename: originalname,
      mimeType: normMime,
      size: buffer.length,
      width: 800,
      height: 600,
      provider: 'ImgBB-Mock',
    };
  }

  // 3. Upload to ImgBB API
  try {
    const base64Data = buffer.toString('base64');
    const params = new URLSearchParams();
    params.append('image', base64Data);
    if (name || originalname) {
      params.append('name', (name || originalname).replace(/\.[^/.]+$/, ''));
    }

    logger.info(`[ImageUploadService] Uploading image (${(buffer.length / 1024).toFixed(1)} KB, MIME: ${normMime}) to ImgBB...`);

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FastPay/1.0',
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    const resData = response.data?.data;
    if (!response.data?.success || !resData) {
      throw new Error(response.data?.error?.message || 'Invalid response from ImgBB API');
    }

    logger.info(`[ImageUploadService] Image uploaded successfully: ${resData.url}`);

    return {
      url: resData.url || resData.display_url,
      displayUrl: resData.display_url || resData.url,
      thumbnailUrl: resData.thumb?.url || resData.url,
      mediumUrl: resData.medium?.url || resData.url,
      deleteUrl: resData.delete_url || null,
      filename: resData.image?.filename || originalname,
      mimeType: resData.image?.mime || normMime,
      size: resData.size || buffer.length,
      width: resData.width || null,
      height: resData.height || null,
      provider: 'ImgBB',
    };
  } catch (err) {
    // Sanitize log output to ensure API key is never logged
    const errMsg = err.response?.data?.error?.message || err.message || 'Failed to upload image to ImgBB';
    logger.error(`[ImageUploadService] Upload failed: ${errMsg}`);

    if (err.response?.status === 400 && errMsg.toLowerCase().includes('key')) {
      throw new ApiError(502, 'Image hosting provider authentication error. Please check server configuration.');
    }

    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new ApiError(504, 'Image upload timed out. Please try again.');
    }

    throw new ApiError(502, `Image upload service error: ${errMsg}`);
  }
};

module.exports = {
  uploadImageToImgBB,
  MAX_IMAGE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
};
