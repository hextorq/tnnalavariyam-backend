const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { z } = require('zod')
const prisma = require('../config/prisma')
const { jwtSecret } = require('../config/env')
const { assertCanAssignRole, validateRoleScope } = require('../services/rbac.service')

const registerSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  scopeId: z.number().int().positive().optional(),
})

const createUserSchema = registerSchema.extend({
  role: z.enum(['STATE_ADMIN', 'DISTRICT_ADMIN', 'TALUK_ADMIN', 'VILLAGE_ADMIN', 'CITIZEN']),
})

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
})

async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body)
    const { password, ...userData } = data
    const passwordHash = await bcrypt.hash(data.password, 12)
    const user = await prisma.user.create({
      data: { ...userData, role: 'CITIZEN', passwordHash },
      select: { id: true, username: true, email: true, firstName: true, lastName: true, role: true, scopeId: true },
    })
    res.status(201).json({ user })
  } catch (error) {
    next(error)
  }
}

async function createScopedUser(req, res, next) {
  try {
    const data = createUserSchema.parse(req.body)
    const scope = await prisma.geoUnit.findUnique({ where: { id: data.scopeId } })
    if (!scope) return res.status(400).json({ message: 'Scope not found' })
    if (!validateRoleScope(data.role, scope.type)) {
      const expectedScope = data.role === 'CITIZEN' ? 'VILLAGE' : data.role.replace('_ADMIN', '')
      return res.status(400).json({ message: `${data.role} must be assigned to a ${expectedScope} scope` })
    }
    if (!(await assertCanAssignRole(req.user, data.role, data.scopeId))) {
      return res.status(403).json({ message: 'You cannot create this role for this scope' })
    }

    const { password, ...userData } = data
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { ...userData, passwordHash },
      select: { id: true, username: true, email: true, firstName: true, lastName: true, role: true, scopeId: true, scope: true },
    })
    res.status(201).json({ user })
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

    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid credentials' })
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

module.exports = { createScopedUser, register, login }
