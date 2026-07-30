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
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          scope: { select: { id: true, name: true, type: true } },
        },
      }),
    ])

    res.json({
      overview: {
        users: {
          total: userCount,
          active: activeUserCount,
          inactive: userCount - activeUserCount,
          byRole: roleCounts.map((item) => ({ role: item.role, count: item._count._all })),
          recent: recentUsers,
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
