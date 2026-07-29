const express = require('express')
const { createContactMessage } = require('../controllers/contact.controller')

const router = express.Router()

router.post('/', createContactMessage)

module.exports = router
