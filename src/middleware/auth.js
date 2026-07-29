const jwt = require('jsonwebtoken')
const prisma = require('../config/prisma')
const { jwtSecret } = require('../config/env')

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null

    if (!token) return res.status(401).json({ message: 'Authentication required' })

    const payload = jwt.verify(token, jwtSecret)
    const user = await prisma.user.findUnique({
      where: { id: Number(payload.sub) },
      include: { scope: true },
    })

    if (!user || !user.isActive) return res.status(401).json({ message: 'Invalid session' })

    req.user = user
    next()
  } catch (error) {
    res.status(401).json({ message: 'Invalid session' })
  }
}

module.exports = { authenticate }
