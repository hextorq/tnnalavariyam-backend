const { applicationForms } = require('../services/formCatalog')
const prisma = require('../config/prisma')
const { z } = require('zod')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const {
  getForwardStatusForLevel,
  getReviewLevelForRole,
  getVisibleSubmissionWhere,
  isAdminRole,
  isFinalReviewLevel,
} = require('../services/rbac.service')
const jwt = require('jsonwebtoken')
const { jwtSecret, uploadDir } = require('../config/env')

const phoneSchema = z.string().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits')

const MAX_INLINE_BASE64_BYTES = 1024 * 1024

function assertNoLargeInlineImages(applicantData) {
  if (!applicantData || typeof applicantData !== 'object') return
  let totalBase64Length = 0
  for (const value of Object.values(applicantData)) {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      totalBase64Length += value.length
    }
  }
  if (totalBase64Length > MAX_INLINE_BASE64_BYTES) {
    const error = new Error(
      `Inline base64 images detected (~${Math.round(totalBase64Length / 1024)} KB). ` +
        'Images must be uploaded via POST /applications/uploads/temp and referenced by path. ' +
        'If you see this, hard-refresh the page (Ctrl+Shift+R) to get the updated form.'
    )
    error.statusCode = 400
    throw error
  }
}

const applicationImageSchema = z.object({
  field: z.string().min(1),
  path: z.string().min(1),
  originalName: z.string().optional().nullable(),
  sizeBytes: z.number().optional().nullable(),
  mimeType: z.string().optional().nullable(),
})

const submissionSchema = z.object({
  formKey: z.string().min(1),
  applicantData: z.record(z.string(), z.unknown()),
  images: z.array(applicationImageSchema).optional(),
  paymentData: z.record(z.string(), z.unknown()).optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  submit: z.boolean().optional(),
})

const trackingSchema = z.object({
  applicationNo: z.string().min(1),
  phone: phoneSchema.optional(),
})

const revisionSchema = z.object({
  applicantData: z.record(z.string(), z.unknown()).optional(),
  images: z.array(applicationImageSchema).optional(),
  paymentData: z.record(z.string(), z.unknown()).optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  submit: z.boolean().optional(),
})

const reviewSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'NEEDS_CORRECTION', 'APPROVED', 'REJECTED']),
  reason: z.string().optional(),
})

const reviewActionByStatus = {
  UNDER_REVIEW: 'REVIEW_STARTED',
  NEEDS_CORRECTION: 'CORRECTION_REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  FORWARDED_TO_TALUK: 'FORWARDED_TO_TALUK',
  FORWARDED_TO_DISTRICT: 'FORWARDED_TO_DISTRICT',
  FORWARDED_TO_STATE: 'FORWARDED_TO_STATE',
}

async function ensureFormExists(key) {
  let form = await prisma.applicationForm.findUnique({ where: { key } })
  if (!form) {
    const catalogItem = applicationForms.find((item) => item.key === key) || {
      key,
      title: key,
      tamilTitle: key,
      feeAmount: 150,
    }
    form = await prisma.applicationForm.create({
      data: {
        key: catalogItem.key,
        title: catalogItem.title,
        tamilTitle: catalogItem.tamilTitle,
        feeAmount: catalogItem.feeAmount ? Number(catalogItem.feeAmount) : null,
        isActive: true,
      },
    })
  }
  return form
}

async function moveImageToSubmission(image, applicationNo) {
  if (!image?.path || typeof image.path !== 'string' || !image.path.startsWith('/uploads/applications/')) {
    throw new Error('Invalid image path')
  }
  const basename = path.basename(image.path)
  if (!basename || basename !== image.path.split('/').at(-1) || basename.includes('..')) {
    throw new Error('Invalid image path')
  }
  const applicationsRoot = path.resolve(uploadDir, 'applications')
  const source = path.resolve(applicationsRoot, basename)
  const destDir = path.resolve(applicationsRoot, applicationNo)
  if (!source.startsWith(`${applicationsRoot}${path.sep}`) || !destDir.startsWith(`${applicationsRoot}${path.sep}`)) {
    throw new Error('Invalid image path')
  }
  await fsp.mkdir(destDir, { recursive: true })
  const dest = path.join(destDir, basename)
  await fsp.rename(source, dest)
  return {
    field: image.field,
    path: `/uploads/applications/${applicationNo}/${basename}`,
    originalName: image.originalName || basename,
    storedName: basename,
    sizeBytes: image.sizeBytes || 0,
    mimeType: image.mimeType || 'image/jpeg',
  }
}

async function removeSubmissionFolder(applicationNo) {
  await fs.rm(path.resolve(uploadDir, 'applications', applicationNo), { recursive: true, force: true })
}

async function listForms(req, res) {
  res.json({ forms: applicationForms })
}

function sanitizeApplicantDataForResponse(applicantData) {
  if (!applicantData || typeof applicantData !== 'object') return applicantData || {}
  const cleaned = { ...applicantData }
  for (const [key, value] of Object.entries(cleaned)) {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      cleaned[key] = null
    }
  }
  return cleaned
}

async function listSubmissions(req, res, next) {
  try {
    const submissions = await prisma.applicationSubmission.findMany({
      where: getVisibleSubmissionWhere(req.user),
      orderBy: { createdAt: 'desc' },
      include: {
        form: true,
        geoUnit: true,
        lastReviewedBy: { select: { id: true, username: true, role: true } },
        user: { select: { id: true, username: true, firstName: true, lastName: true, phone: true, role: true } },
        documents: { orderBy: { createdAt: 'asc' } },
      },
    })
    for (const submission of submissions) {
      submission.applicantData = sanitizeApplicantDataForResponse(submission.applicantData)
    }
    res.json({ submissions })
  } catch (error) {
    next(error)
  }
}

async function createSubmission(req, res, next) {
  try {
    const data = submissionSchema.parse(req.body)
    const form = await ensureFormExists(data.formKey)
    if (!form || !form.isActive) return res.status(400).json({ message: 'Application form not found or inactive' })
    assertNoLargeInlineImages(data.applicantData)

    const applicationNo = `TNW-${Date.now()}-${req.user.id}`
    const paymentAmount = form.feeAmount ? Number(form.feeAmount) : null

    let applicantData = data.applicantData
    const movedImages = []
    for (const image of data.images || []) {
      const moved = await moveImageToSubmission(image, applicationNo)
      movedImages.push(moved)
      applicantData = { ...applicantData, [moved.field]: moved.path }
    }

    try {
      const submission = await prisma.$transaction(async (tx) => {
        const created = await tx.applicationSubmission.create({
          data: {
            applicationNo,
            userId: req.user.id,
            formId: form.id,
            geoUnitId: req.user.scopeId,
            applicantData,
            paymentData: data.paymentData || {},
            paymentAmount,
            paymentReference: data.paymentReference,
            paymentStatus: data.paymentReference ? 'PAID' : 'PENDING',
            paymentPaidAt: data.paymentReference ? new Date() : null,
            status: data.submit ? 'SUBMITTED' : 'DRAFT',
            submittedAt: data.submit ? new Date() : null,
            reviewHistory: data.submit
              ? {
                  create: {
                    actorId: req.user.id,
                    action: 'SUBMITTED',
                    toStatus: 'SUBMITTED',
                  },
                }
              : undefined,
          },
          include: { form: true, geoUnit: true },
        })

        if (movedImages.length) {
          await tx.uploadedDocument.createMany({
            data: movedImages.map((m) => ({
              submissionId: created.id,
              fieldKey: m.field,
              originalName: m.originalName,
              storedName: m.storedName,
              mimeType: m.mimeType,
              sizeBytes: m.sizeBytes,
              path: m.path,
            })),
          })
        }
        return created
      })
      res.status(201).json({ submission })
    } catch (error) {
      await removeSubmissionFolder(applicationNo)
      throw error
    }
  } catch (error) {
    next(error)
  }
}

async function trackSubmission(req, res, next) {
  try {
    const data = trackingSchema.parse({ ...req.query, ...req.body })
    const submission = await prisma.applicationSubmission.findUnique({
      where: { applicationNo: data.applicationNo.trim() },
      include: {
        form: true,
        geoUnit: true,
        user: { select: { firstName: true, lastName: true, phone: true } },
        reviewHistory: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { actor: { select: { username: true, role: true } } },
        },
      },
    })

    if (!submission) return res.status(404).json({ message: 'Application not found' })

    // Check if the user is authenticated optionally
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    let isAuthenticated = false
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret)
        const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } })
        if (user && user.isActive) {
          isAuthenticated = true
        }
      } catch (e) {
        // ignore
      }
    }

    if (!isAuthenticated) {
      if (!data.phone) {
        return res.status(400).json({ message: 'Phone number is required for public tracking' })
      }
      const targetPhone = String(data.phone).trim()
      const userPhone = String(submission.user?.phone || '').trim()
      const applicantPhone = String(
        submission.applicantData?.phone ||
        submission.applicantData?.mobile ||
        submission.applicantData?.contactPhone ||
        ''
      ).trim()

      const isMatch = (targetPhone === userPhone || targetPhone === applicantPhone)
      if (!isMatch && (userPhone || applicantPhone)) {
        return res.status(404).json({ message: 'Application not found' })
      }
    }

    const applicantData = submission.applicantData || {}
    const applicantName =
      applicantData.workerName ||
      applicantData.fullName ||
      [submission.user?.firstName, submission.user?.lastName].filter(Boolean).join(' ') ||
      'Applicant'

    res.json({
      tracking: {
        applicationNo: submission.applicationNo,
        formTitle: submission.form.title,
        tamilFormTitle: submission.form.tamilTitle,
        applicantName,
        scope: submission.geoUnit?.name || null,
        status: submission.status,
        paymentStatus: submission.paymentStatus,
        paymentAmount: submission.paymentAmount,
        paymentReference: submission.paymentReference,
        currentReviewReason: submission.currentReviewReason,
        revisionCount: submission.revisionCount,
        reviewHistory: submission.reviewHistory,
        submittedAt: submission.submittedAt,
        updatedAt: submission.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

async function reviseSubmission(req, res, next) {
  try {
    const id = Number(req.params.id)
    const data = revisionSchema.parse(req.body)
    const submission = await prisma.applicationSubmission.findFirst({
      where: { id, userId: req.user.id },
      include: { form: true },
    })

    if (!submission) return res.status(404).json({ message: 'Application not found' })
    if (!['DRAFT', 'NEEDS_CORRECTION', 'REJECTED'].includes(submission.status)) {
      return res.status(400).json({ message: 'This application cannot be edited in the current status' })
    }
    assertNoLargeInlineImages(data.applicantData)

    const movedImages = []
    let applicantData = data.applicantData || submission.applicantData
    for (const image of data.images || []) {
      const moved = await moveImageToSubmission(image, submission.applicationNo)
      movedImages.push(moved)
      applicantData = { ...applicantData, [moved.field]: moved.path }
    }

    const nextStatus = data.submit ? (submission.status === 'DRAFT' ? 'SUBMITTED' : 'RESUBMITTED') : 'DRAFT'
    const nextPaymentReference = data.paymentReference ?? submission.paymentReference
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.applicationSubmission.update({
        where: { id },
        data: {
          applicantData,
          paymentData: data.paymentData || submission.paymentData,
          paymentReference: nextPaymentReference,
          paymentStatus: nextPaymentReference ? 'PAID' : submission.paymentStatus,
          paymentPaidAt: nextPaymentReference && !submission.paymentPaidAt ? new Date() : submission.paymentPaidAt,
          status: nextStatus,
          submittedAt: data.submit ? new Date() : submission.submittedAt,
          currentReviewReason: data.submit ? null : submission.currentReviewReason,
          revisionCount: data.submit && submission.status !== 'DRAFT' ? { increment: 1 } : undefined,
          reviewHistory: {
            create: {
              actorId: req.user.id,
              action: data.submit ? (submission.status === 'DRAFT' ? 'SUBMITTED' : 'RESUBMITTED') : 'UPDATED',
              fromStatus: submission.status,
              toStatus: nextStatus,
            },
          },
        },
        include: { form: true, geoUnit: true, reviewHistory: { orderBy: { createdAt: 'desc' }, take: 5 } },
      })

      if (movedImages.length) {
        const oldDocs = await tx.uploadedDocument.findMany({
          where: { submissionId: id, fieldKey: { in: movedImages.map((m) => m.field) } },
        })
        await tx.uploadedDocument.deleteMany({
          where: { submissionId: id, fieldKey: { in: movedImages.map((m) => m.field) } },
        })
        await tx.uploadedDocument.createMany({
          data: movedImages.map((m) => ({
            submissionId: id,
            fieldKey: m.field,
            originalName: m.originalName,
            storedName: m.storedName,
            mimeType: m.mimeType,
            sizeBytes: m.sizeBytes,
            path: m.path,
          })),
        })
        for (const old of oldDocs) {
          if (!old.path.startsWith('/uploads/applications/')) continue
          const applicationsRoot = path.resolve(uploadDir, 'applications')
          const isInSubmissionFolder = old.path.startsWith(`/uploads/applications/${submission.applicationNo}/`)
          const target = isInSubmissionFolder
            ? path.join(applicationsRoot, submission.applicationNo, path.basename(old.path))
            : path.join(applicationsRoot, path.basename(old.path))
          await fs.rm(target, { force: true }).catch(() => {})
        }
      }
      return result
    })

    res.json({ submission: updated })
  } catch (error) {
    next(error)
  }
}

async function reviewSubmission(req, res, next) {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ message: 'Only hierarchy users can review applications' })

    const id = Number(req.params.id)
    const data = reviewSchema.parse(req.body)
    if (['NEEDS_CORRECTION', 'REJECTED'].includes(data.status) && !data.reason) {
      return res.status(400).json({ message: 'Reason is required when returning or rejecting an application' })
    }

    const submission = await prisma.applicationSubmission.findFirst({
      where: { AND: [{ id }, getVisibleSubmissionWhere(req.user)] },
    })
    if (!submission) return res.status(404).json({ message: 'Application not found in your hierarchy scope' })
    if (submission.userId === req.user.id) {
      return res.status(403).json({ message: 'You cannot review your own application' })
    }

    const reviewerLevel = getReviewLevelForRole(req.user.role)
    if (req.user.role !== 'SUPER_ADMIN' && reviewerLevel !== submission.currentReviewLevel) {
      return res.status(403).json({ message: 'This application is awaiting action at another review level' })
    }

    let nextStatus = data.status
    let nextLevel = submission.currentReviewLevel

    if (data.status === 'APPROVED') {
      if (isFinalReviewLevel(submission.currentReviewLevel)) {
        nextStatus = 'APPROVED'
      } else {
        nextLevel = submission.currentReviewLevel + 1
        nextStatus = getForwardStatusForLevel(nextLevel)
      }
    }

    const updated = await prisma.applicationSubmission.update({
      where: { id },
      data: {
        status: nextStatus,
        currentReviewLevel: nextLevel,
        currentReviewReason: ['NEEDS_CORRECTION', 'REJECTED'].includes(nextStatus) ? data.reason : null,
        lastReviewedById: req.user.id,
        lastReviewedAt: new Date(),
        reviewHistory: {
          create: {
            actorId: req.user.id,
            action: reviewActionByStatus[nextStatus],
            fromStatus: submission.status,
            toStatus: nextStatus,
            reason: data.reason,
          },
        },
      },
      include: {
        form: true,
        geoUnit: true,
        user: { select: { id: true, username: true, firstName: true, lastName: true, phone: true } },
        reviewHistory: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    })

    res.json({ submission: updated })
  } catch (error) {
    next(error)
  }
}

async function uploadApplicationTemp(req, res, next) {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ message: 'No file uploaded' })
    res.status(201).json({
      upload: {
        field: file.fieldname,
        path: `/uploads/applications/${file.filename}`,
        originalName: file.originalname,
        sizeBytes: file.size,
        mimeType: file.mimetype,
      },
    })
  } catch (error) {
    next(error)
  }
}

async function deleteApplicationTemp(req, res, next) {
  try {
    const publicPath = req.query?.path || req.body?.path
    if (!publicPath || typeof publicPath !== 'string' || !publicPath.startsWith('/uploads/applications/')) {
      return res.status(400).json({ message: 'Invalid upload path' })
    }
    const basename = path.basename(publicPath)
    if (!basename || basename !== publicPath.split('/').at(-1)) {
      return res.status(400).json({ message: 'Invalid upload path' })
    }
    const uploadRoot = path.resolve(uploadDir, 'applications')
    const targetPath = path.resolve(uploadRoot, basename)
    if (!targetPath.startsWith(`${uploadRoot}${path.sep}`)) {
      return res.status(400).json({ message: 'Invalid upload path' })
    }
    await fs.rm(targetPath, { force: true })
    res.json({ deleted: true })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  listForms,
  listSubmissions,
  createSubmission,
  reviseSubmission,
  reviewSubmission,
  trackSubmission,
  uploadApplicationTemp,
  deleteApplicationTemp,
}
