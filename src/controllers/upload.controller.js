const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const { uploadImageToImgBB } = require('../services/imageUpload.service');

/**
 * Handle protected image upload
 * Accepts multipart/form-data with field name 'image' or 'file'
 */
const uploadImage = asyncHandler(async (req, res) => {
  const file = req.file;

  if (!file) {
    throw new ApiError(400, "No image file uploaded. Please provide an image file under the 'image' field.");
  }

  const result = await uploadImageToImgBB({
    buffer: file.buffer,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    name: req.body?.name || '',
  });

  return ApiResponse.success(res, result, 'Image uploaded successfully to hosting provider', 201);
});

module.exports = {
  uploadImage,
};
