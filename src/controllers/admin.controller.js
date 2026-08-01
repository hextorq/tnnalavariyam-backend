const bcrypt = require('bcryptjs')
const { z } = require('zod')
const prisma = require('../config/prisma')
const {
  assertCanAssignRole,
  getCreatableRoles,
  getVisibleScopeWhere,
  getVisibleSignupWhere,
  getVisibleSubmissionWhere,
  roleRank,
  validateRoleScope,
} = require('../services/rbac.service')

const phoneSchema = z.string().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits')

const createUserSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username can only contain letters, numbers, dots, dashes and underscores'),
  email: z.string().email(),
  phone: phoneSchema,
  fullName: z.string().min(2, 'Full name is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.enum(['STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN', 'PARTNER']),
  scopeId: z.preprocess((value) => (value ? Number(value) : undefined), z.number().int().positive()),
})

function getVisibleUserWhere(user) {
  if (!user) return { id: -1 }
  if (user.role === 'SUPER_ADMIN') return {}
  if (!user.scope) return { id: -1 }

  return {
    OR: [
      { scopeId: user.scopeId },
      { scope: { is: { path: { startsWith: `${user.scope.path}${user.scope.id}/` } } } },
    ],
  }
}

function latestByUser(items, userIdKey, getActivity) {
  const byUser = new Map()
  for (const item of items) {
    const userId = item[userIdKey]
    if (!userId) continue
    const activity = getActivity(item)
    const current = byUser.get(userId)
    if (!current || new Date(activity.at) > new Date(current.at)) {
      byUser.set(userId, activity)
    }
  }
  return byUser
}

async function getAdminOverview(req, res, next) {
  try {
    const userWhere = getVisibleUserWhere(req.user)
    const signupWhere = getVisibleSignupWhere(req.user)
    const submissionWhere = getVisibleSubmissionWhere(req.user)
    const scopeWhere = getVisibleScopeWhere(req.user)
    const [
      userCount,
      activeUserCount,
      roleCounts,
      geoUnitCounts,
      formCount,
      activeFormCount,
      signupStatusCounts,
      applicationStatusCounts,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count({ where: userWhere }),
      prisma.user.count({ where: { AND: [userWhere, { isActive: true }] } }),
      prisma.user.groupBy({ by: ['role'], where: userWhere, _count: { _all: true } }),
      prisma.geoUnit.groupBy({ by: ['type'], where: scopeWhere, _count: { _all: true } }),
      prisma.applicationForm.count(),
      prisma.applicationForm.count({ where: { isActive: true } }),
      prisma.userSignupRequest.groupBy({ by: ['status'], where: signupWhere, _count: { _all: true } }),
      prisma.applicationSubmission.groupBy({ by: ['status'], where: submissionWhere, _count: { _all: true } }),
      prisma.user.findMany({
        where: userWhere,
        orderBy: [{ isActive: 'desc' }, { lastLoginAt: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          scope: { select: { id: true, name: true, type: true } },
        },
      }),
    ])

    const recentUserIds = recentUsers.map((user) => user.id)
    const [latestAuditLogs, latestSubmissions, latestReviews] = recentUserIds.length ? await Promise.all([
      prisma.auditLog.findMany({
        where: { userId: { in: recentUserIds } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { userId: true, action: true, createdAt: true },
      }),
      prisma.applicationSubmission.findMany({
        where: { userId: { in: recentUserIds } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: { userId: true, applicationNo: true, status: true, updatedAt: true },
      }),
      prisma.applicationReview.findMany({
        where: { actorId: { in: recentUserIds } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { actorId: true, action: true, createdAt: true, submission: { select: { applicationNo: true } } },
      }),
    ]) : [[], [], []]

    const auditActivityByUser = latestByUser(latestAuditLogs, 'userId', (item) => ({
      type: item.action,
      label: item.action === 'LOGIN' ? 'Logged in' : item.action,
      at: item.createdAt,
    }))
    const submissionActivityByUser = latestByUser(latestSubmissions, 'userId', (item) => ({
      type: 'APPLICATION',
      label: `${item.status} application ${item.applicationNo}`,
      at: item.updatedAt,
    }))
    const reviewActivityByUser = latestByUser(latestReviews, 'actorId', (item) => ({
      type: 'REVIEW',
      label: `${item.action} ${item.submission?.applicationNo || 'application'}`,
      at: item.createdAt,
    }))

    const recentUsersWithActivity = recentUsers.map((user) => {
      const candidates = [
        auditActivityByUser.get(user.id),
        submissionActivityByUser.get(user.id),
        reviewActivityByUser.get(user.id),
      ].filter(Boolean)
      const latestActivity = candidates.sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null
      return { ...user, latestActivity }
    })

    res.json({
      overview: {
        users: {
          total: userCount,
          active: activeUserCount,
          inactive: userCount - activeUserCount,
          byRole: roleCounts.map((item) => ({ role: item.role, count: item._count._all })),
          recent: recentUsersWithActivity,
        },
        geoUnits: geoUnitCounts.map((item) => ({ type: item.type, count: item._count._all })),
        forms: {
          total: formCount,
          active: activeFormCount,
          inactive: formCount - activeFormCount,
        },
        signupRequests: signupStatusCounts.map((item) => ({ status: item.status, count: item._count._all })),
        applications: applicationStatusCounts.map((item) => ({ status: item.status, count: item._count._all })),
      },
    })
  } catch (error) {
    next(error)
  }
}

async function createUser(req, res, next) {
  try {
    const data = createUserSchema.parse(req.body)

    if (!getCreatableRoles(req.user.role).includes(data.role)) {
      return res.status(403).json({ message: `You cannot create users with role ${data.role}` })
    }

    if (!(await assertCanAssignRole(req.user, data.role, data.scopeId))) {
      return res.status(403).json({ message: 'Scope access denied. User must be created inside your hierarchy scope' })
    }

    const scope = await prisma.geoUnit.findUnique({ where: { id: data.scopeId } })
    if (!scope || !validateRoleScope(data.role, scope.type)) {
      return res.status(400).json({ message: `${data.role} cannot be assigned to the selected scope` })
    }

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { email: data.email }, { phone: data.phone }] },
      select: { username: true, email: true, phone: true },
    })
    if (existingUser) {
      return res.status(409).json({ message: 'A user already exists with this username, email or phone' })
    }

    const pendingRequest = await prisma.userSignupRequest.findFirst({
      where: {
        status: 'PENDING',
        OR: [{ username: data.username }, { email: data.email }, { phone: data.phone }],
      },
    })
    if (pendingRequest) {
      return res.status(409).json({ message: 'A pending signup request already exists for this username, email or phone' })
    }

    const passwordHash = await bcrypt.hash(data.password, 12)
    const parts = data.fullName.trim().split(/\s+/)

    const user = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        phone: data.phone,
        passwordHash,
        role: data.role,
        scopeId: data.scopeId,
        name: data.fullName,
        firstName: parts[0],
        lastName: parts.slice(1).join(' ') || null,
        isActive: true,
        auditLogs: {
          create: {
            action: 'USER_CREATED_BY_ADMIN',
            metadata: { actorId: req.user.id, role: data.role, scopeId: data.scopeId },
          },
        },
      },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        scopeId: true,
        scope: { select: { id: true, name: true, type: true } },
      },
    })

    res.status(201).json({ message: 'User created and activated successfully', user })
  } catch (error) {
    next(error)
  }
}

async function updateUserLoginStatus(req, res, next) {
  try {
    const id = Number(req.params.id)
    const isActive = Boolean(req.body?.isActive)
    if (!Number.isInteger(id)) return res.status(400).json({ message: 'Invalid user id' })
    if (id === req.user.id) return res.status(400).json({ message: 'You cannot block your own login' })

    const targetUser = await prisma.user.findFirst({
      where: { AND: [getVisibleUserWhere(req.user), { id }] },
      select: { id: true, username: true, role: true, isActive: true },
    })
    if (!targetUser) return res.status(404).json({ message: 'User not found in your hierarchy scope' })
    if (req.user.role !== 'SUPER_ADMIN' && roleRank[targetUser.role] <= roleRank[req.user.role]) {
      return res.status(403).json({ message: 'You cannot change login access for this role' })
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        isActive,
        auditLogs: {
          create: {
            action: isActive ? 'LOGIN_UNBLOCKED' : 'LOGIN_BLOCKED',
            metadata: { actorId: req.user.id },
          },
        },
      },
      select: { id: true, username: true, role: true, isActive: true, lastLoginAt: true },
    })

    res.json({ user })
  } catch (error) {
    next(error)
  }
}

module.exports = { createUser, getAdminOverview, updateUserLoginStatus }
