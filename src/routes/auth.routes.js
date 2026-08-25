const express = require('express')
const {
  changePassword,
  checkSignupAvailability,
  deleteSignupTemp,
  forgotPassword,
  getMe,
  listSignupRequests,
  login,
  requestSignup,
  resetPassword,
  reviewSignupRequest,
  trackSignupRequest,
  updateProfile,
  uploadSignupTemp,
} = require('../controllers/auth.controller')
const { authenticate } = require('../middleware/auth')
const { uploadSignupFiles, uploadSignupTempFile } = require('../middleware/upload')
const { requireRole } = require('../services/rbac.service')

const router = express.Router()

router.get('/me', authenticate, getMe)
router.patch('/profile', authenticate, updateProfile)
router.patch('/profile/password', authenticate, changePassword)
router.get('/availability', checkSignupAvailability)
router.post('/uploads/signup-temp', uploadSignupTempFile, uploadSignupTemp)
router.delete('/uploads/signup-temp', deleteSignupTemp)
router.post('/register', uploadSignupFiles, requestSignup)
router.post('/login', login)
router.post('/forgot-password', forgotPassword)
router.post('/reset-password', resetPassword)
router.get('/signup-requests', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), listSignupRequests)
router.patch('/signup-requests/:id/review', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), reviewSignupRequest)
router.get('/signup-requests/track', trackSignupRequest)
router.post('/signup-requests/track', trackSignupRequest)

module.exports = router
