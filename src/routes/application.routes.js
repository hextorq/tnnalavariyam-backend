const express = require('express')
const {
  listForms,
  listSubmissions,
  createSubmission,
  reviseSubmission,
  reviewSubmission,
  trackSubmission,
} = require('../controllers/application.controller')
const { authenticate } = require('../middleware/auth')

const router = express.Router()

router.get('/forms', listForms)
router.get('/track', trackSubmission)
router.post('/track', trackSubmission)
router.get('/submissions', authenticate, listSubmissions)
router.post('/submissions', authenticate, createSubmission)
router.patch('/submissions/:id', authenticate, reviseSubmission)
router.patch('/submissions/:id/review', authenticate, reviewSubmission)

module.exports = router
