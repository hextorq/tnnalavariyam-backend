const prisma = require('../config/prisma')
const { getVisibleScopeWhere, getVisibleSignupWhere, getVisibleSubmissionWhere } = require('../services/rbac.service')

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
        where: { AND: [userWhere, { isActive: true }] },
        orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'desc' }],
        take: 50,
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

module.exports = { getAdminOverview }
