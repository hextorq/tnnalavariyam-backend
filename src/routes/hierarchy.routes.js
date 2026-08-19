const express = require('express')
const { createGeoUnit, getScopeOptions, getTamilNaduHierarchy, listGeoUnits } = require('../controllers/hierarchy.controller')
const { authenticate } = require('../middleware/auth')
const { requireRole } = require('../services/rbac.service')

const router = express.Router()

router.get('/options', getScopeOptions)
router.get('/tamil-nadu', getTamilNaduHierarchy)
router.get('/geo-units', listGeoUnits)
router.post('/geo-units', authenticate, requireRole('SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN'), createGeoUnit)

module.exports = router
