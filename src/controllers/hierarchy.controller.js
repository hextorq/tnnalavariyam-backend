const { z } = require('zod')
const prisma = require('../config/prisma')
const { getCreatableRoles, getRoleScopeType } = require('../services/rbac.service')

const geoUnitSchema = z.object({
  name: z.string().min(1),
  tamilName: z.string().optional(),
  type: z.enum(['STATE', 'DISTRICT', 'TALUK', 'VILLAGE']),
  code: z.string().optional(),
  parentId: z.number().int().positive().optional(),
})

const parentTypeByUnitType = {
  DISTRICT: 'STATE',
  TALUK: 'DISTRICT',
  VILLAGE: 'TALUK',
}

async function listGeoUnits(req, res, next) {
  try {
    const units = await prisma.geoUnit.findMany({
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { parent: true },
    })
    res.json({ units })
  } catch (error) {
    next(error)
  }
}

async function createGeoUnit(req, res, next) {
  try {
    const data = geoUnitSchema.parse(req.body)
    let path = '/'
    let parent = null

    if (data.parentId) {
      parent = await prisma.geoUnit.findUnique({ where: { id: data.parentId } })
      if (!parent) return res.status(400).json({ message: 'Parent geo unit not found' })
      if (parent.type !== parentTypeByUnitType[data.type]) {
        return res.status(400).json({ message: `${data.type} must be created under ${parentTypeByUnitType[data.type]}` })
      }
      path = `${parent.path}${parent.id}/`
    } else if (data.type !== 'STATE') {
      return res.status(400).json({ message: `${data.type} requires a parent scope` })
    }

    if (data.type === 'STATE' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Only SUPER_ADMIN can create state scopes' })
    }

    if (req.user.role !== 'SUPER_ADMIN') {
      if (!req.user.scope || !parent) return res.status(403).json({ message: 'Scope access denied' })
      const parentIsVisible = parent.id === req.user.scopeId || parent.path.startsWith(`${req.user.scope.path}${req.user.scope.id}/`)
      if (!parentIsVisible) return res.status(403).json({ message: 'Scope access denied' })
    }

    const unit = await prisma.geoUnit.create({ data: { ...data, path } })
    res.status(201).json({ unit })
  } catch (error) {
    next(error)
  }
}

function getScopeOptions(req, res) {
  const roles = ['SUPER_ADMIN', 'STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN', 'PARTNER', 'CITIZEN']
  const roleScopes = Object.fromEntries(
    roles.map((role) => [role, ['PARTNER', 'CITIZEN'].includes(role) ? 'VILLAGE' : getRoleScopeType(role)]),
  )
  const canCreateRoles = Object.fromEntries(roles.map((role) => [role, getCreatableRoles(role)]))

  res.json({
    roles,
    hierarchy: ['STATE', 'DISTRICT', 'TALUK', 'VILLAGE'],
    roleScopes,
    canCreateRoles,
    rule: 'Every admin sees applications and signup requests in their assigned scope and all child scopes. Partners see only their own applications.',
    creationRule: 'Direct user creation is disabled. Public users submit signup requests for a role and scope; higher hierarchy users approve only lower-level requests inside their assigned scope.',
  })
}

module.exports = { createGeoUnit, getScopeOptions, listGeoUnits }
