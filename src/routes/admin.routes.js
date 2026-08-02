const express = require('express')
const { createUser, getAdminOverview, getHierarchyApplications, updateUserLoginStatus } = require('../controllers/admin.controller')
const { authenticate } = require('../middleware/auth')
const { requireRole } = require('../services/rbac.service')

const router = express.Router()

router.get('/overview', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), getAdminOverview)
router.get('/hierarchy-applications', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), getHierarchyApplications)
router.post('/users', authenticate, requireRole('SUPER_ADMIN'), createUser)
router.patch('/users/:id/login-status', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN'), updateUserLoginStatus)

module.exports = router
