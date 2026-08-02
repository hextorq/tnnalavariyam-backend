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

function emptyHierarchyCounts() {
  return {
    applications: { total: 0, byStatus: {} },
    signupRequests: { total: 0, byStatus: {} },
    users: { total: 0, active: 0, partners: 0 },
  }
}

function addStatusCount(target, status, count = 1) {
  const key = status || 'UNKNOWN'
  target.total += count
  target.byStatus[key] = (target.byStatus[key] || 0) + count
}

function getNodeLabel(node) {
  const tamilName = String(node?.tamilName || '').trim()
  const name = String(node?.name || '').trim()
  if (tamilName && name && tamilName !== name) return `${tamilName} / ${name}`
  return tamilName || name
}

function sortByName(a, b) {
  return getNodeLabel(a).localeCompare(getNodeLabel(b), 'ta')
}

function isSameOrDescendant(scope, ancestor) {
  if (!scope || !ancestor) return false
  return scope.id === ancestor.id || scope.path.startsWith(`${ancestor.path}${ancestor.id}/`)
}

function getFirstHierarchyType(user) {
  if (user.role === 'SUPER_ADMIN' || user.role === 'STATE_ADMIN') return 'DISTRICT'
  if (user.role === 'DISTRICT_ADMIN') return 'TALUK'
  if (user.role === 'TALUK_ADMIN') return 'VILLAGE'
  if (user.role === 'VILLAGE_ADMIN') return 'VILLAGE'
  return null
}

async function getHierarchyApplications(req, res, next) {
  try {
    const scopeWhere = getVisibleScopeWhere(req.user)
    const submissionWhere = getVisibleSubmissionWhere(req.user)
    const signupWhere = getVisibleSignupWhere(req.user)

    const geoUnits = await prisma.geoUnit.findMany({
      where: scopeWhere,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, tamilName: true, type: true, parentId: true, path: true },
    })

    const geoIds = geoUnits.map((unit) => unit.id)
    const userWhere = geoIds.length ? { scopeId: { in: geoIds } } : { id: -1 }

    const [submissions, signupRequests, users] = await Promise.all([
      prisma.applicationSubmission.findMany({
        where: submissionWhere,
        select: {
          id: true,
          applicationNo: true,
          status: true,
          geoUnitId: true,
          userId: true,
          createdAt: true,
          updatedAt: true,
          form: { select: { title: true, tamilTitle: true } },
          user: { select: { id: true, username: true, firstName: true, phone: true, role: true, scopeId: true } },
        },
      }),
      prisma.userSignupRequest.findMany({
        where: signupWhere,
        select: { id: true, status: true, requestedRole: true, scopeId: true },
      }),
      prisma.user.findMany({
        where: userWhere,
        orderBy: [{ role: 'asc' }, { username: 'asc' }],
        select: { id: true, username: true, firstName: true, phone: true, role: true, isActive: true, lastLoginAt: true, scopeId: true },
      }),
    ])

    const nodeMap = new Map()
    for (const unit of geoUnits) {
      nodeMap.set(unit.id, {
        ...unit,
        label: getNodeLabel(unit),
        counts: emptyHierarchyCounts(),
        children: [],
        partners: [],
        recentApplications: [],
      })
    }

    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId).children.push(node)
      }
    }

    const directSubmissionsByScope = new Map()
    for (const submission of submissions) {
      if (!submission.geoUnitId || !nodeMap.has(submission.geoUnitId)) continue
      const items = directSubmissionsByScope.get(submission.geoUnitId) || []
      items.push(submission)
      directSubmissionsByScope.set(submission.geoUnitId, items)
    }

    const directSignupsByScope = new Map()
    for (const request of signupRequests) {
      if (!request.scopeId || !nodeMap.has(request.scopeId)) continue
      const items = directSignupsByScope.get(request.scopeId) || []
      items.push(request)
      directSignupsByScope.set(request.scopeId, items)
    }

    const usersByScope = new Map()
    for (const user of users) {
      if (!user.scopeId || !nodeMap.has(user.scopeId)) continue
      const items = usersByScope.get(user.scopeId) || []
      items.push(user)
      usersByScope.set(user.scopeId, items)
    }

    for (const node of nodeMap.values()) {
      const nodeSubmissions = directSubmissionsByScope.get(node.id) || []
      for (const submission of nodeSubmissions) {
        addStatusCount(node.counts.applications, submission.status)
      }

      const nodeSignups = directSignupsByScope.get(node.id) || []
      for (const request of nodeSignups) {
        addStatusCount(node.counts.signupRequests, request.status)
      }

      const nodeUsers = usersByScope.get(node.id) || []
      for (const user of nodeUsers) {
        node.counts.users.total += 1
        if (user.isActive) node.counts.users.active += 1
        if (user.role === 'PARTNER') node.counts.users.partners += 1
      }

      if (node.type === 'VILLAGE') {
        node.partners = nodeUsers
          .filter((user) => user.role === 'PARTNER')
          .map((partner) => {
            const partnerSubmissions = submissions.filter((submission) => submission.userId === partner.id)
            const counts = { total: 0, byStatus: {} }
            for (const submission of partnerSubmissions) addStatusCount(counts, submission.status)
            return {
              id: partner.id,
              username: partner.username,
              name: partner.firstName || partner.username,
              phone: partner.phone,
              isActive: partner.isActive,
              lastLoginAt: partner.lastLoginAt,
              applications: counts,
            }
          })
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      }

      node.recentApplications = nodeSubmissions
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
        .slice(0, 5)
    }

    const orderedNodes = [...nodeMap.values()].sort((a, b) => b.path.length - a.path.length)
    for (const node of orderedNodes) {
      if (!node.parentId || !nodeMap.has(node.parentId)) continue
      const parent = nodeMap.get(node.parentId)
      for (const [status, count] of Object.entries(node.counts.applications.byStatus)) {
        addStatusCount(parent.counts.applications, status, count)
      }
      for (const [status, count] of Object.entries(node.counts.signupRequests.byStatus)) {
        addStatusCount(parent.counts.signupRequests, status, count)
      }
      parent.counts.users.total += node.counts.users.total
      parent.counts.users.active += node.counts.users.active
      parent.counts.users.partners += node.counts.users.partners
    }

    for (const node of nodeMap.values()) {
      node.children.sort(sortByName)
      node.childCount = node.children.length
    }

    const firstType = getFirstHierarchyType(req.user)
    const scopedRoots = firstType
      ? [...nodeMap.values()].filter((node) => {
          if (node.type !== firstType) return false
          if (req.user.role === 'VILLAGE_ADMIN') return node.id === req.user.scopeId
          if (!req.user.scope) return true
          return isSameOrDescendant(node, req.user.scope)
        })
      : []

    const roots = (scopedRoots.length ? scopedRoots : [...nodeMap.values()].filter((node) => !node.parentId || !nodeMap.has(node.parentId))).sort(sortByName)

    res.json({
      hierarchy: {
        role: req.user.role,
        scope: req.user.scope || null,
        firstType,
        total: {
          geoUnits: geoUnits.length,
          applications: submissions.length,
          signupRequests: signupRequests.length,
          partners: users.filter((user) => user.role === 'PARTNER').length,
        },
        roots,
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

module.exports = { createUser, getAdminOverview, getHierarchyApplications, updateUserLoginStatus }
