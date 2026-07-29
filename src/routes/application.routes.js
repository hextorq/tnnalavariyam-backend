const express = require('express')
const { listForms, listSubmissions, createSubmission, trackSubmission } = require('../controllers/application.controller')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

router.get('/forms', listForms)
router.get('/track', trackSubmission)
router.post('/track', trackSubmission)
router.get('/submissions', authenticate, listSubmissions)
router.post('/submissions', authenticate, createSubmission)

module.exports = router
