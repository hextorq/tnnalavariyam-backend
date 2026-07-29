const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { uploadDir } = require('../config/env')

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const targetDir = path.resolve(uploadDir, 'signup')
    fs.mkdirSync(targetDir, { recursive: true })
    cb(null, targetDir)
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '')
    const safeName = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    cb(null, safeName)
  },
})

const uploadSignupFiles = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).fields([
  { name: 'photo', maxCount: 1 },
  { name: 'idProof', maxCount: 1 },
])

module.exports = { uploadSignupFiles }
