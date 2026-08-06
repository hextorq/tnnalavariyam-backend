const router = require('express').Router()
const { authenticate } = require('../middleware/auth')
const { createBill, listBills } = require('../controllers/billing.controller')

router.use(authenticate)

router.post('/', createBill)
router.get('/', listBills)

module.exports = router
