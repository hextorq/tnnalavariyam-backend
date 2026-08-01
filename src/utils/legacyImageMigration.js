const path = require('path')
const crypto = require('crypto')
const prisma = require('../config/prisma')
const { uploadDir } = require('../config/env')
const fs = require('fs')
const fsp = fs.promises

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const state = {
  running: false,
  lastRun: null,
  processedRows: 0,
  extractedImages: 0,
  totalBase64MB: 0,
}

function extractBase64Images(applicantData) {
  const images = []
  for (const [field, value] of Object.entries(applicantData || {})) {
    if (typeof value !== 'string') continue
    const m = value.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/)
    if (!m) continue
    images.push({ field, mimeType: `image/${m[1].toLowerCase()}`, data: m[2] })
  }
  return images
}

async function migrateLegacyBase64Images() {
  if (state.running) return state
  state.running = true
  try {
    const submissions = await prisma.applicationSubmission.findMany({
      select: { id: true, applicationNo: true, applicantData: true },
      orderBy: { id: 'asc' },
    })

    const applicationsRoot = path.resolve(uploadDir, 'applications')
    let processedRows = 0
    let extractedImages = 0
    let totalBase64MB = 0

    for (const submission of submissions) {
      const images = extractBase64Images(submission.applicantData)
      if (!images.length) continue
      processedRows++

      const destDir = path.resolve(applicationsRoot, submission.applicationNo)
      if (!destDir.startsWith(`${applicationsRoot}${path.sep}`)) continue
      await fsp.mkdir(destDir, { recursive: true })

      const applicantData = { ...submission.applicantData }
      for (const image of images) {
        try {
          const buf = Buffer.from(image.data, 'base64')
          if (!buf.length) continue
          const ext = MIME_EXT[image.mimeType] || 'jpg'
          const storedName = `${image.field}-${crypto.randomBytes(4).toString('hex')}.${ext}`
          const dest = path.join(destDir, storedName)
          if (!dest.startsWith(`${destDir}${path.sep}`)) continue
          await fsp.writeFile(dest, buf)
          applicantData[image.field] = `/uploads/applications/${submission.applicationNo}/${storedName}`
          const existing = await prisma.uploadedDocument.findFirst({
            where: { submissionId: submission.id, fieldKey: image.field },
          })
          const docData = {
            submissionId: submission.id,
            fieldKey: image.field,
            originalName: `${image.field}.${ext}`,
            storedName,
            mimeType: image.mimeType,
            sizeBytes: buf.length,
            path: applicantData[image.field],
          }
          if (existing) {
            await prisma.uploadedDocument.update({ where: { id: existing.id }, data: docData })
          } else {
            await prisma.uploadedDocument.create({ data: docData })
          }
          extractedImages++
          totalBase64MB += buf.length / (1024 * 1024)
          console.log(
            `[legacy-migration] ${submission.applicationNo} ${image.field}: ${(buf.length / 1024).toFixed(0)} KB -> ${storedName}`
          )
        } catch (err) {
          console.error(`[legacy-migration] failed ${submission.applicationNo}/${image.field}:`, err.message)
        }
      }

      await prisma.applicationSubmission.update({
        where: { id: submission.id },
        data: { applicantData },
      })
    }

    state.lastRun = new Date().toISOString()
    state.processedRows = processedRows
    state.extractedImages = extractedImages
    state.totalBase64MB = Math.round(totalBase64MB * 100) / 100
    console.log(
      `[legacy-migration] done: ${processedRows} rows, ${extractedImages} images, ${state.totalBase64MB} MB of base64 moved to files`
    )
  } catch (err) {
    console.error('[legacy-migration] error:', err)
  } finally {
    state.running = false
  }
  return state
}

module.exports = { migrateLegacyBase64Images, migrationState: state }
