const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { uploadDir } = require('../config/env')

const MB = 1024 * 1024
const MAX_FILE_SIZE = 2 * MB
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png'])

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const targetDir = path.resolve(uploadDir, 'signup')
    fs.mkdirSync(targetDir, { recursive: true })
    cb(null, targetDir)
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase()
    const safeName = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    cb(null, safeName)
  },
})

function validateFileType(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  const isExtensionAllowed = ALLOWED_EXTENSIONS.has(ext)
  const isMimeAllowed = ALLOWED_MIME_TYPES.has(file.mimetype?.toLowerCase())

  if (!isExtensionAllowed || !isMimeAllowed) {
    return cb(new Error('Only JPEG (.jpg, .jpeg) and PNG (.png) files are accepted / JPEG மற்றும் PNG படங்கள் மட்டுமே ஏற்றுக் கொள்ளப்படும்.'))
  }

  return cb(null, true)
}

const signupUpload = multer({
  storage,
  fileFilter: validateFileType,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
})

const applicationStorage = multer.diskStorage({
  destination(req, file, cb) {
    const targetDir = path.resolve(uploadDir, 'applications')
    fs.mkdirSync(targetDir, { recursive: true })
    cb(null, targetDir)
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase()
    const safeName = `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    cb(null, safeName)
  },
})

const applicationUpload = multer({
  storage: applicationStorage,
  fileFilter: validateFileType,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
})

const uploadApplicationTempBase = applicationUpload.single('file')

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
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size must be within 2 MB / கோப்பின் அளவு 2 MB-க்குள் இருக்க வேண்டும்.' })
      }
      return res.status(400).json({ message: error.message || 'File upload error' })
    }

    const photo = req.files?.photo?.[0]
    const idProof = req.files?.idProof?.[0]
    if (photo && photo.size > MAX_FILE_SIZE) {
      removeUploadedFile(photo)
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'Passport photo must be within 2 MB / புகைப்படம் 2 MB-க்குள் இருக்க வேண்டும்.' })
    }
    if (idProof && idProof.size > MAX_FILE_SIZE) {
      removeUploadedFile(photo)
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'ID proof document must be within 2 MB / ஆவணம் 2 MB-க்குள் இருக்க வேண்டும்.' })
    }
    return next()
  })
}

function uploadSignupTempFile(req, res, next) {
  uploadSignupTempBase(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size must be within 2 MB / கோப்பின் அளவு 2 MB-க்குள் இருக்க வேண்டும்.' })
      }
      return res.status(400).json({ message: error.message || 'File upload error' })
    }

    const photo = req.files?.photo?.[0]
    const idProof = req.files?.idProof?.[0]
    if (!photo && !idProof) return res.status(400).json({ message: 'No file uploaded' })
    if (photo && idProof) {
      removeUploadedFile(photo)
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'Upload one file at a time' })
    }
    if (photo && photo.size > MAX_FILE_SIZE) {
      removeUploadedFile(photo)
      return res.status(400).json({ message: 'Passport photo must be within 2 MB / புகைப்படம் 2 MB-க்குள் இருக்க வேண்டும்.' })
    }
    if (idProof && idProof.size > MAX_FILE_SIZE) {
      removeUploadedFile(idProof)
      return res.status(400).json({ message: 'ID proof document must be within 2 MB / ஆவணம் 2 MB-க்குள் இருக்க வேண்டும்.' })
    }
    return next()
  })
}

function uploadApplicationTempFile(req, res, next) {
  uploadApplicationTempBase(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size must be within 2 MB / கோப்பின் அளவு 2 MB-க்குள் இருக்க வேண்டும்.' })
      }
      return res.status(400).json({ message: error.message || 'File upload error' })
    }

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    if (req.file.size > MAX_FILE_SIZE) {
      removeUploadedFile(req.file)
      return res.status(400).json({ message: 'File size must be within 2 MB / கோப்பின் அளவு 2 MB-க்குள் இருக்க வேண்டும்.' })
    }
    return next()
  })
}

module.exports = { uploadSignupFiles, uploadSignupTempFile, uploadApplicationTempFile }
