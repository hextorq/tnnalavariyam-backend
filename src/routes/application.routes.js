const express = require('express')
const { listForms, listSubmissions, createSubmission } = require('../controllers/application.controller')

const router = express.Router()

router.get('/forms', listForms)
router.get('/submissions', listSubmissions)
router.post('/submissions', createSubmission)

module.exports = router
