const express = require('express')
const { getAdminOverview } = require('../controllers/admin.controller')
const { authenticate } = require('../middleware/auth')
const { requireRole } = require('../services/rbac.service')

const router = express.Router()

router.get('/overview', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), getAdminOverview)

module.exports = router
