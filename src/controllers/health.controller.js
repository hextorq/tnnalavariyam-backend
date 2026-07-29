const prisma = require('../config/prisma')
const { nodeEnv } = require('../config/env')

async function healthCheck(req, res) {
  const startedAt = Date.now()
  const checks = {
    api: {
      ok: true,
      service: 'tn-nalavaariyam-api',
      environment: nodeEnv,
      uptimeSeconds: Math.round(process.uptime()),
    },
    database: {
      ok: false,
    },
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database.ok = true
  } catch (error) {
    console.error('Health check database failure:', error)
    checks.database.message = 'Database connection failed'
  }

  const ok = checks.api.ok && checks.database.ok
  res.status(ok ? 200 : 503).json({
    ok,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks,
  })
}

module.exports = { healthCheck }
