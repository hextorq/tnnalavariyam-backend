const prisma = require('../config/prisma')

async function getAdminOverview(req, res, next) {
  try {
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
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.geoUnit.groupBy({ by: ['type'], _count: { _all: true } }),
      prisma.applicationForm.count(),
      prisma.applicationForm.count({ where: { isActive: true } }),
      prisma.userSignupRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.applicationSubmission.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.user.findMany({
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
