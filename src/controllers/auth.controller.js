const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { z } = require('zod')
const prisma = require('../config/prisma')
const { jwtSecret } = require('../config/env')
const {
  assertCanApproveSignup,
  getVisibleSignupWhere,
  validateRoleScope,
} = require('../services/rbac.service')

const phoneSchema = z.string().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits')
const pincodeSchema = z.string().regex(/^\d{6}$/, 'Pincode must be exactly 6 digits')

const signupRequestSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  confirmPassword: z.string().optional(),
  fullName: z.string().min(2),
  phone: phoneSchema,
  addressLine: z.string().min(5),
  state: z.string().default('Tamil Nadu'),
  district: z.string().min(1),
  taluk: z.string().optional().default(''),
  village: z.string().optional().default(''),
  districtCode: z.string().min(1),
  talukCode: z.string().optional().default(''),
  villageCode: z.string().optional().default(''),
  pincode: pincodeSchema,
  requestedRole: z.enum(['DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN', 'PARTNER']),
  scopeId: z.preprocess((value) => value ? Number(value) : undefined, z.number().int().positive().optional()),
  photoPath: z.string().min(1),
  idProofType: z.enum(['VOTER_ID', 'RATION_CARD', 'AADHAR_CARD', 'PAN_CARD', 'DRIVING_LICENSE']),
  idProofNumber: z.string().optional(),
  idProofPath: z.string().min(1),
}).refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
}).refine((data) => data.requestedRole === 'DISTRICT_ADMIN' || data.taluk, {
  message: 'Taluk is required for this role',
  path: ['taluk'],
}).refine((data) => data.requestedRole === 'DISTRICT_ADMIN' || data.talukCode, {
  message: 'Taluk code is required for this role',
  path: ['talukCode'],
}).refine((data) => !['VILLAGE_ADMIN', 'PARTNER'].includes(data.requestedRole) || data.village, {
  message: 'Village is required for this role',
  path: ['village'],
}).refine((data) => !['VILLAGE_ADMIN', 'PARTNER'].includes(data.requestedRole) || data.villageCode, {
  message: 'Village code is required for this role',
  path: ['villageCode'],
})

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
})

const availabilitySchema = z.object({
  username: z.string().optional(),
  email: z.string().email().optional(),
  phone: phoneSchema.optional(),
}).refine((data) => data.username || data.email || data.phone, {
  message: 'Username, email or phone is required',
})

const signupTrackingSchema = z.object({
  requestNo: z.string().min(1),
  phone: phoneSchema.optional(),
})

const signupReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().optional(),
})

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/)
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ') || null,
  }
}

function publicUploadPath(file) {
  if (!file) return undefined
  return `/uploads/signup/${file.filename}`
}

function getRequestedScopeCode(data) {
  if (data.scopeId) return null
  if (data.requestedRole === 'DISTRICT_ADMIN') return `DISTRICT-${data.districtCode}`
  if (data.requestedRole === 'TALUK_ADMIN') return `TALUK-${data.talukCode}`
  return `VILLAGE-${data.villageCode}`
}

async function upsertGeoUnit({ code, name, type, parentId, path }) {
  return prisma.geoUnit.upsert({
    where: { code },
    update: { name, tamilName: name, type, parentId, path },
    create: { code, name, tamilName: name, type, parentId, path },
  })
}

async function ensureSignupScope(data) {
  if (data.scopeId) return prisma.geoUnit.findUnique({ where: { id: data.scopeId } })

  const state = await upsertGeoUnit({
    code: 'STATE-33',
    name: 'Tamil Nadu',
    type: 'STATE',
    parentId: null,
    path: '/',
  })
  const district = await upsertGeoUnit({
    code: `DISTRICT-${data.districtCode}`,
    name: data.district,
    type: 'DISTRICT',
    parentId: state.id,
    path: `${state.path}${state.id}/`,
  })
  if (data.requestedRole === 'DISTRICT_ADMIN') return district

  const taluk = await upsertGeoUnit({
    code: `TALUK-${data.talukCode}`,
    name: data.taluk,
    type: 'TALUK',
    parentId: district.id,
    path: `${district.path}${district.id}/`,
  })
  if (data.requestedRole === 'TALUK_ADMIN') return taluk

  return upsertGeoUnit({
    code: `VILLAGE-${data.villageCode}`,
    name: data.village,
    type: 'VILLAGE',
    parentId: taluk.id,
    path: `${taluk.path}${taluk.id}/`,
  })
}

async function checkSignupAvailability(req, res, next) {
  try {
    const data = availabilitySchema.parse(req.query)
    const fields = ['username', 'email', 'phone'].filter((field) => data[field])
    const activeUser = await prisma.user.findFirst({
      where: { OR: fields.map((field) => ({ [field]: data[field] })) },
      select: { username: true, email: true, phone: true },
    })
    const pendingRequest = await prisma.userSignupRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: fields.map((field) => ({ [field]: data[field] })),
      },
      select: { username: true, email: true, phone: true },
    })

    const conflicts = {}
    for (const field of fields) {
      conflicts[field] = {
        available: activeUser?.[field] !== data[field] && pendingRequest?.[field] !== data[field],
        activeUser: activeUser?.[field] === data[field],
        pendingRequest: pendingRequest?.[field] === data[field],
      }
    }

    res.json({
      available: Object.values(conflicts).every((conflict) => conflict.available),
      conflicts,
    })
  } catch (error) {
    next(error)
  }
}

async function requestSignup(req, res, next) {
  try {
    const files = req.files || {}
    const data = signupRequestSchema.parse({
      ...req.body,
      photoPath: req.body.photoPath || publicUploadPath(files.photo?.[0]),
      idProofPath: req.body.idProofPath || publicUploadPath(files.idProof?.[0]),
    })
    if (data.state.toLowerCase() !== 'tamil nadu') {
      return res.status(400).json({ message: 'State must be Tamil Nadu' })
    }

    const scope = await ensureSignupScope(data)
    if (!scope) {
      return res.status(400).json({
        message: 'Selected hierarchy scope not found',
        requestedScopeCode: getRequestedScopeCode(data),
      })
    }
    if (!validateRoleScope(data.requestedRole, scope.type)) {
      return res.status(400).json({ message: `${data.requestedRole} cannot be requested for ${scope.type} scope` })
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { email: data.email }, { phone: data.phone }] },
    })
    if (existingUser) return res.status(409).json({ message: 'An active user already exists with this username, email or phone' })

    const existingRequest = await prisma.userSignupRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [{ username: data.username }, { email: data.email }, { phone: data.phone }],
      },
    })
    if (existingRequest) return res.status(409).json({ message: 'A pending signup request already exists for this email or phone' })

    const passwordHash = await bcrypt.hash(data.password, 12)
    const requestNo = `TNSU-${Date.now()}`
    const { password, confirmPassword, districtCode, talukCode, villageCode, scopeId, ...requestData } = data
    const signupRequest = await prisma.userSignupRequest.create({
      data: { ...requestData, requestNo, passwordHash, scopeId: scope.id },
      select: {
        id: true,
        requestNo: true,
        username: true,
        requestedRole: true,
        status: true,
        fullName: true,
        email: true,
        phone: true,
        state: true,
        district: true,
        taluk: true,
        village: true,
        pincode: true,
        createdAt: true,
      },
    })

    res.status(201).json({
      message: 'Signup request submitted. Account login will be enabled only after hierarchy approval.',
      signupRequest,
    })
  } catch (error) {
    next(error)
  }
}

async function listSignupRequests(req, res, next) {
  try {
    const requests = await prisma.userSignupRequest.findMany({
      where: getVisibleSignupWhere(req.user),
      orderBy: { createdAt: 'desc' },
      include: {
        scope: true,
        reviewedBy: { select: { id: true, username: true, role: true } },
      },
    })
    res.json({ requests })
  } catch (error) {
    next(error)
  }
}

async function reviewSignupRequest(req, res, next) {
  try {
    const id = Number(req.params.id)
    const data = signupReviewSchema.parse(req.body)
    if (data.status === 'REJECTED' && !data.reason) {
      return res.status(400).json({ message: 'Reason is required when rejecting a signup request' })
    }

    const signupRequest = await prisma.userSignupRequest.findUnique({
      where: { id },
      include: { scope: true },
    })
    if (!signupRequest) return res.status(404).json({ message: 'Signup request not found' })
    if (signupRequest.status !== 'PENDING') return res.status(400).json({ message: 'Signup request already reviewed' })
    if (!(await assertCanApproveSignup(req.user, signupRequest.requestedRole, signupRequest.scopeId))) {
      return res.status(403).json({ message: 'You cannot approve or reject this role request' })
    }

    if (data.status === 'REJECTED') {
      const rejected = await prisma.userSignupRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewReason: data.reason,
          reviewedById: req.user.id,
          reviewedAt: new Date(),
        },
        include: { scope: true, reviewedBy: { select: { id: true, username: true, role: true } } },
      })
      return res.json({ signupRequest: rejected })
    }

    const name = splitName(signupRequest.fullName)
    const user = await prisma.user.create({
      data: {
        username: signupRequest.username,
        email: signupRequest.email,
        phone: signupRequest.phone,
        passwordHash: signupRequest.passwordHash,
        role: signupRequest.requestedRole,
        scopeId: signupRequest.scopeId,
        isActive: true,
        name: signupRequest.fullName,
        firstName: name.firstName,
        lastName: name.lastName,
      },
      select: { id: true, username: true, email: true, phone: true, role: true, scopeId: true },
    })

    const approved = await prisma.userSignupRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewReason: data.reason,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        approvedUserId: user.id,
      },
      include: { scope: true, reviewedBy: { select: { id: true, username: true, role: true } } },
    })

    res.json({ signupRequest: approved, user })
  } catch (error) {
    next(error)
  }
}

async function trackSignupRequest(req, res, next) {
  try {
    const data = signupTrackingSchema.parse({ ...req.query, ...req.body })
    const signupRequest = await prisma.userSignupRequest.findUnique({
      where: { requestNo: data.requestNo },
      include: { scope: true, reviewedBy: { select: { username: true, role: true } } },
    })
    if (!signupRequest) return res.status(404).json({ message: 'Signup request not found' })
    if (data.phone && signupRequest.phone !== data.phone) return res.status(404).json({ message: 'Signup request not found' })

    res.json({
      tracking: {
        requestNo: signupRequest.requestNo,
        fullName: signupRequest.fullName,
        requestedRole: signupRequest.requestedRole,
        scope: signupRequest.scope.name,
        status: signupRequest.status,
        reason: signupRequest.reviewReason,
        reviewedBy: signupRequest.reviewedBy,
        reviewedAt: signupRequest.reviewedAt,
        createdAt: signupRequest.createdAt,
      },
    })
  } catch (error) {
    next(error)
  }
}

async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body)
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username: data.identifier }, { email: data.identifier }, { phone: data.identifier }],
      },
    })

    if (!user || !user.isActive || !(await bcrypt.compare(data.password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid credentials or account not approved yet' })
    }

    const token = jwt.sign({ sub: user.id, role: user.role, scopeId: user.scopeId }, jwtSecret, { expiresIn: '7d' })
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role, scopeId: user.scopeId },
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  checkSignupAvailability,
  listSignupRequests,
  login,
  requestSignup,
  reviewSignupRequest,
  trackSignupRequest,
}
