const sensitiveKeys = new Set([
  'authorization',
  'confirmPassword',
  'idProofNumber',
  'password',
  'passwordHash',
  'token',
])

function redact(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redact)

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKeys.has(key) ? '[REDACTED]' : redact(item),
    ]),
  )
}

function parseBody(body) {
  if (Buffer.isBuffer(body)) return `[buffer:${body.length}]`
  if (typeof body !== 'string') return body

  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

function requestLogger(req, res, next) {
  const startedAt = Date.now()
  const { getRequestMetrics } = require('../services/requestContext')
  const originalJson = res.json.bind(res)
  const originalSend = res.send.bind(res)
  let responseBody

  function getTimings() {
    const dbMetrics = getRequestMetrics()
    return {
      responseTimeMs: Date.now() - startedAt,
      dbTimeMs: dbMetrics.dbTimeMs,
      dbQueryCount: dbMetrics.dbQueryCount,
    }
  }

  function setTimingHeaders(timings) {
    if (res.headersSent) return
    res.setHeader('X-Response-Time-Ms', String(timings.responseTimeMs))
    res.setHeader('X-DB-Time-Ms', String(timings.dbTimeMs))
    res.setHeader('X-DB-Query-Count', String(timings.dbQueryCount))
  }

  res.json = (body) => {
    const timings = getTimings()
    setTimingHeaders(timings)
    responseBody = body && typeof body === 'object' && !Array.isArray(body)
      ? { ...body, _timings: timings }
      : body
    return originalJson(responseBody)
  }

  res.send = (body) => {
    const timings = getTimings()
    setTimingHeaders(timings)
    if (responseBody === undefined) responseBody = parseBody(body)
    return originalSend(body)
  }

  res.on('finish', () => {
    const timings = getTimings()
    console.log(JSON.stringify({
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTimeMs: timings.responseTimeMs,
      dbTimeMs: timings.dbTimeMs,
      dbQueryCount: timings.dbQueryCount,
      request: {
        params: redact(req.params),
        query: redact(req.query),
        body: redact(req.body),
      },
      response: redact(responseBody),
    }, null, 2))
  })

  next()
}

module.exports = { requestLogger }
