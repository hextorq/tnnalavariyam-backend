const express = require('express')
const authRoutes = require('./auth.routes')
const applicationRoutes = require('./application.routes')
const contactRoutes = require('./contact.routes')
const hierarchyRoutes = require('./hierarchy.routes')

const router = express.Router()

router.use('/auth', authRoutes)
router.use('/applications', applicationRoutes)
router.use('/contact', contactRoutes)
router.use('/hierarchy', hierarchyRoutes)

module.exports = router
