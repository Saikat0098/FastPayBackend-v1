const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');
const { verifyToken } = require('../middlewares/auth.middleware');
const { uploadLimiter } = require('../middlewares/rateLimiter.middleware');
const ApiError = require('../utils/apiError');
const { MAX_IMAGE_SIZE_BYTES, ALLOWED_MIME_TYPES } = require('../services/imageUpload.service');

// Configure Multer Memory Storage (no temporary files stored on disk)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const normMime = (file.mimetype || '').toLowerCase().trim();
  if (ALLOWED_MIME_TYPES.includes(normMime)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, `Unsupported file format '${file.mimetype}'. Allowed formats: JPG, PNG, WEBP, GIF`), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_SIZE_BYTES,
  },
  fileFilter,
});

// Middleware to handle both 'image' and 'file' field names with Multer error handling
const handleSingleImageUpload = (req, res, next) => {
  const singleUpload = upload.single('image');
  singleUpload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(400, 'File size exceeds the 5MB limit. Please upload a smaller image.'));
      }
      return next(new ApiError(400, `Upload error: ${err.message}`));
    } else if (err) {
      return next(err);
    }

    // If 'image' was not present, try checking if 'file' was uploaded
    if (!req.file) {
      const fallbackUpload = upload.single('file');
      return fallbackUpload(req, res, (fallbackErr) => {
        if (fallbackErr instanceof multer.MulterError) {
          if (fallbackErr.code === 'LIMIT_FILE_SIZE') {
            return next(new ApiError(400, 'File size exceeds the 5MB limit. Please upload a smaller image.'));
          }
          return next(new ApiError(400, `Upload error: ${fallbackErr.message}`));
        } else if (fallbackErr) {
          return next(fallbackErr);
        }
        next();
      });
    }

    next();
  });
};

// Protected routes (Requires valid JWT session)
router.use(verifyToken);

router.post('/image', uploadLimiter, handleSingleImageUpload, uploadController.uploadImage);
router.post('/', uploadLimiter, handleSingleImageUpload, uploadController.uploadImage);

module.exports = router;
