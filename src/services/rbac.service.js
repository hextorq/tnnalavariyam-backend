const prisma = require('../config/prisma')

const roleRank = {
  SUPER_ADMIN: 0,
  STATE_ADMIN: 1,
  DISTRICT_ADMIN: 2,
  TALUK_ADMIN: 3,
  VILLAGE_ADMIN: 4,
  PARTNER: 5,
  CITIZEN: 6,
}

const roleScopeType = {
  STATE_ADMIN: 'STATE',
  DISTRICT_ADMIN: 'DISTRICT',
  TALUK_ADMIN: 'TALUK',
  VILLAGE_ADMIN: 'VILLAGE',
}

function isAdminRole(role) {
  return !['PARTNER', 'CITIZEN'].includes(role)
}

// Review pipeline levels: 1 = Village, 2 = Taluk, 3 = District, 4 = State (final).
const reviewLevelByRole = {
  VILLAGE_ADMIN: 1,
  TALUK_ADMIN: 2,
  DISTRICT_ADMIN: 3,
  STATE_ADMIN: 4,
  SUPER_ADMIN: 4,
}

const forwardStatusByLevel = {
  2: 'FORWARDED_TO_TALUK',
  3: 'FORWARDED_TO_DISTRICT',
  4: 'FORWARDED_TO_STATE',
}

function getReviewLevelForRole(role) {
  return reviewLevelByRole[role] || null
}

function isFinalReviewLevel(level) {
  return level >= 4
}

function getForwardStatusForLevel(level) {
  return forwardStatusByLevel[level] || null
}

// Statuses that require action at each level of the pipeline.
const actionableStatusesByLevel = {
  1: ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW'],
  2: ['FORWARDED_TO_TALUK'],
  3: ['FORWARDED_TO_DISTRICT'],
  4: ['FORWARDED_TO_STATE'],
}

function getActionableStatusesForLevel(level) {
  return actionableStatusesByLevel[level] || []
}

function getRoleScopeType(role) {
  return roleScopeType[role] || null
}

function getCreatableRoles(role) {
  if (!isAdminRole(role)) return []
  return Object.entries(roleRank)
    .filter(([targetRole]) => targetRole !== 'CITIZEN')
    .filter(([, rank]) => rank > roleRank[role])
    .map(([targetRole]) => targetRole)
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' })
    }
    next()
  }
}

function getVisibleSubmissionWhere(user) {
  if (!user) return { id: -1 }
  if (user.role === 'SUPER_ADMIN') return {}
  if (user.role === 'STATE_ADMIN' && !user.scopeId) return {}
  if (!isAdminRole(user.role)) return { userId: user.id }
  if (!user.scope) return { id: -1 }

  return {
    OR: [
      { geoUnitId: user.scopeId },
      { geoUnit: { is: { path: { startsWith: `${user.scope.path}${user.scope.id}/` } } } },
    ],
  }
}

function getVisibleScopeWhere(user) {
  if (!user) return { id: -1 }
  if (user.role === 'SUPER_ADMIN') return {}
  if (user.role === 'STATE_ADMIN' && !user.scopeId) return {}
  if (!isAdminRole(user.role) || !user.scope) return { id: -1 }

  return {
    OR: [
      { id: user.scopeId },
      { path: { startsWith: `${user.scope.path}${user.scope.id}/` } },
    ],
  }
}

function getVisibleSignupWhere(user) {
  if (!user) return { id: -1 }
  if (user.role === 'SUPER_ADMIN') return {}
  if (user.role === 'STATE_ADMIN' && !user.scopeId) return {}
  if (!isAdminRole(user.role) || !user.scope) return { id: -1 }

  return {
    scope: {
      is: {
        OR: [
          { id: user.scopeId },
          { path: { startsWith: `${user.scope.path}${user.scope.id}/` } },
        ],
      },
    },
    requestedRole: { in: getCreatableRoles(user.role) },
  }
}

async function assertCanApproveSignup(actor, requestedRole, targetScopeId) {
  return assertCanAssignRole(actor, requestedRole, targetScopeId)
}

async function assertCanAssignRole(actor, targetRole, targetScopeId) {
  if (!actor || !isAdminRole(actor.role)) return false
  if (roleRank[targetRole] <= roleRank[actor.role]) return false
  if (actor.role === 'SUPER_ADMIN') return true
  if (actor.role === 'STATE_ADMIN' && !actor.scopeId) return true
  if (!targetScopeId || !actor.scope) return false

  const targetScope = await prisma.geoUnit.findUnique({ where: { id: targetScopeId } })
  if (!targetScope) return false

  return targetScope.id === actor.scopeId || targetScope.path.startsWith(`${actor.scope.path}${actor.scope.id}/`)
}

function validateRoleScope(role, scopeType) {
  if (role === 'SUPER_ADMIN') return true
  if (['PARTNER', 'CITIZEN'].includes(role)) return scopeType === 'VILLAGE'
  return roleScopeType[role] === scopeType
}

module.exports = {
  assertCanAssignRole,
  assertCanApproveSignup,
  getActionableStatusesForLevel,
  getCreatableRoles,
  getForwardStatusForLevel,
  getReviewLevelForRole,
  getRoleScopeType,
  getVisibleScopeWhere,
  getVisibleSignupWhere,
  getVisibleSubmissionWhere,
  isAdminRole,
  isFinalReviewLevel,
  requireRole,
  roleRank,
  validateRoleScope,
}
