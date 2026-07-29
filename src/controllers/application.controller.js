const { applicationForms } = require('../services/formCatalog')
const prisma = require('../config/prisma')
const { z } = require('zod')
const { getVisibleSubmissionWhere } = require('../services/rbac.service')

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
        submittedAt: submission.submittedAt,
        updatedAt: submission.updatedAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

module.exports = { listForms, listSubmissions, createSubmission, trackSubmission }
