const { applicationForms } = require('../services/formCatalog')
const prisma = require('../config/prisma')
const { z } = require('zod')
const { getVisibleSubmissionWhere, isAdminRole } = require('../services/rbac.service')

const submissionSchema = z.object({
  formKey: z.string().min(1),
  applicantData: z.record(z.string(), z.unknown()),
  paymentData: z.record(z.string(), z.unknown()).optional(),
  paymentReference: z.string().optional(),
  submit: z.boolean().optional(),
})

const trackingSchema = z.object({
  applicationNo: z.string().min(1),
  phone: z.string().optional(),
})

const revisionSchema = z.object({
  applicantData: z.record(z.string(), z.unknown()).optional(),
  paymentData: z.record(z.string(), z.unknown()).optional(),
  paymentReference: z.string().optional(),
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
}

async function listForms(req, res) {
  res.json({ forms: applicationForms })
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
      },
    })
    res.json({ submissions })
  } catch (error) {
    next(error)
  }
}

async function createSubmission(req, res, next) {
  try {
    const data = submissionSchema.parse(req.body)
    const form = await prisma.applicationForm.findUnique({ where: { key: data.formKey } })
    if (!form || !form.isActive) return res.status(400).json({ message: 'Application form not found or inactive' })

    const applicationNo = `TNW-${Date.now()}-${req.user.id}`
    const paymentAmount = form.feeAmount ? Number(form.feeAmount) : null
    const submission = await prisma.applicationSubmission.create({
      data: {
        applicationNo,
        userId: req.user.id,
        formId: form.id,
        geoUnitId: req.user.scopeId,
        applicantData: data.applicantData,
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

    res.status(201).json({ submission })
  } catch (error) {
    next(error)
  }
}

async function trackSubmission(req, res, next) {
  try {
    const data = trackingSchema.parse({ ...req.query, ...req.body })
    const submission = await prisma.applicationSubmission.findUnique({
      where: { applicationNo: data.applicationNo },
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
    if (data.phone && submission.user.phone && submission.user.phone !== data.phone) {
      return res.status(404).json({ message: 'Application not found' })
    }

    res.json({
      tracking: {
        applicationNo: submission.applicationNo,
        formTitle: submission.form.title,
        tamilFormTitle: submission.form.tamilTitle,
        applicantName: [submission.user.firstName, submission.user.lastName].filter(Boolean).join(' '),
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

    const nextStatus = data.submit ? (submission.status === 'DRAFT' ? 'SUBMITTED' : 'RESUBMITTED') : 'DRAFT'
    const nextPaymentReference = data.paymentReference ?? submission.paymentReference
    const updated = await prisma.applicationSubmission.update({
      where: { id },
      data: {
        applicantData: data.applicantData || submission.applicantData,
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

    const updated = await prisma.applicationSubmission.update({
      where: { id },
      data: {
        status: data.status,
        currentReviewReason: ['NEEDS_CORRECTION', 'REJECTED'].includes(data.status) ? data.reason : null,
        lastReviewedById: req.user.id,
        lastReviewedAt: new Date(),
        reviewHistory: {
          create: {
            actorId: req.user.id,
            action: reviewActionByStatus[data.status],
            fromStatus: submission.status,
            toStatus: data.status,
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

module.exports = { listForms, listSubmissions, createSubmission, reviseSubmission, reviewSubmission, trackSubmission }
