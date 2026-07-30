const express = require('express')
const {
  checkSignupAvailability,
  listSignupRequests,
  login,
  requestSignup,
  reviewSignupRequest,
  trackSignupRequest,
} = require('../controllers/auth.controller')
const { authenticate } = require('../middleware/auth')
const { uploadSignupFiles } = require('../middleware/upload')
const { requireRole } = require('../services/rbac.service')

const router = express.Router()

router.get('/availability', checkSignupAvailability)
router.post('/register', uploadSignupFiles, requestSignup)
router.post('/login', login)
router.get('/signup-requests', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), listSignupRequests)
router.patch('/signup-requests/:id/review', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), reviewSignupRequest)
router.get('/signup-requests/track', trackSignupRequest)
router.post('/signup-requests/track', trackSignupRequest)

module.exports = router
