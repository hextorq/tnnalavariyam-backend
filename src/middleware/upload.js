const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { uploadDir } = require('../config/env')

const MB = 1024 * 1024
const uploadRules = {
  photo: {
    maxSize: 5 * MB,
    extensions: new Set(['.jpg', '.jpeg', '.png', '.webp']),
    mimePrefixes: ['image/'],
  },
  idProof: {
    maxSize: 15 * MB,
    extensions: new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt']),
    mimePrefixes: ['image/'],
    mimeTypes: new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ]),
  },
}

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

function validateFileType(req, file, cb) {
  const rule = uploadRules[file.fieldname]
  if (!rule) return cb(new Error('Unsupported upload field'))

  const ext = path.extname(file.originalname || '').toLowerCase()
  const mimeAllowed = rule.mimePrefixes.some((prefix) => file.mimetype?.startsWith(prefix)) || rule.mimeTypes?.has(file.mimetype)
  const extensionAllowed = rule.extensions.has(ext)

  if (!mimeAllowed && !extensionAllowed) {
    return cb(new Error(file.fieldname === 'photo'
      ? 'Passport photo must be an image file'
      : 'ID proof must be an image, PDF, Word, Excel or text document'))
  }

  return cb(null, true)
}

const signupUpload = multer({
  storage,
  fileFilter: validateFileType,
  limits: {
    fileSize: 15 * MB,
  },
})

const uploadSignupFilesBase = signupUpload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'idProof', maxCount: 1 },
])
const uploadSignupTempBase = signupUpload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'idProof', maxCount: 1 },
])

function removeUploadedFile(file) {
  if (file?.path) fs.rmSync(file.path, { force: true })
}

function uploadSignupFiles(req, res, next) {
  uploadSignupFilesBase(req, res, (error) => {
    if (error) return next(error)

    const photo = req.files?.photo?.[0]
    const idProof = req.files?.idProof?.[0]
    if (photo && photo.size > uploadRules.photo.maxSize) {
      removeUploadedFile(photo)
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'Passport photo must be 5 MB or less' })
    }
    if (idProof && idProof.size > uploadRules.idProof.maxSize) {
      removeUploadedFile(photo)
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'ID proof document must be 15 MB or less' })
    }
    return next()
  })
}

function uploadSignupTempFile(req, res, next) {
  uploadSignupTempBase(req, res, (error) => {
    if (error) return next(error)

    const photo = req.files?.photo?.[0]
    const idProof = req.files?.idProof?.[0]
    if (!photo && !idProof) return res.status(400).json({ message: 'No signup file uploaded' })
    if (photo && idProof) {
      removeUploadedFile(photo)
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'Upload one file at a time' })
    }
    if (photo && photo.size > uploadRules.photo.maxSize) {
      removeUploadedFile(photo)
      return res.status(400).json({ message: 'Passport photo must be 5 MB or less' })
    }
    if (idProof && idProof.size > uploadRules.idProof.maxSize) {
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'ID proof document must be 15 MB or less' })
    }
    return next()
  })
}

module.exports = { uploadSignupFiles, uploadSignupTempFile }
