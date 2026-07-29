const express = require('express')
const { createScopedUser, login, register } = require('../controllers/auth.controller')
const { authenticate } = require('../middleware/auth')
const { requireRole } = require('../services/rbac.service')

const router = express.Router()

router.post('/register', register)
router.post('/login', login)
router.post('/users', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), createScopedUser)

module.exports = router
