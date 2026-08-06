const express = require('express')
const adminRoutes = require('./admin.routes')
const authRoutes = require('./auth.routes')
const applicationRoutes = require('./application.routes')
const billingRoutes = require('./billing.routes')
const contactRoutes = require('./contact.routes')
const healthRoutes = require('./health.routes')
const hierarchyRoutes = require('./hierarchy.routes')

const router = express.Router()

router.use('/admin', adminRoutes)
router.use('/auth', authRoutes)
router.use('/applications', applicationRoutes)
router.use('/bills', billingRoutes)
router.use('/contact', contactRoutes)
router.use('/health', healthRoutes)
router.use('/hierarchy', hierarchyRoutes)

module.exports = router
