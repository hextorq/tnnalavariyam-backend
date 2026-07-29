const prisma = require('../config/prisma')
const { nodeEnv } = require('../config/env')

const requiredTables = [
  'ApplicationForm',
  'ApplicationReview',
  'ApplicationSubmission',
  'AuditLog',
  'ContactMessage',
  'GeoUnit',
  'UploadedDocument',
  'User',
  'UserSignupRequest',
]

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
    schema: {
      ok: false,
    },
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database.ok = true

    const existingTables = await prisma.$queryRaw`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
    `
    const existingTableNames = new Set(existingTables.map((table) => table.TABLE_NAME))
    const missingTables = requiredTables.filter((table) => !existingTableNames.has(table))

    checks.schema = {
      ok: missingTables.length === 0,
      requiredTables,
      missingTables,
    }
  } catch (error) {
    console.error('Health check database failure:', error)
    checks.database.message = 'Database connection failed'
    checks.schema.message = 'Schema check skipped because database connection failed'
  }

  const ok = checks.api.ok && checks.database.ok && checks.schema.ok
  res.status(ok ? 200 : 503).json({
    ok,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    checks,
  })
}

module.exports = { healthCheck }
