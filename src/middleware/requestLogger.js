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
  const originalJson = res.json.bind(res)
  const originalSend = res.send.bind(res)
  let responseBody

  res.json = (body) => {
    responseBody = body
    return originalJson(body)
  }

  res.send = (body) => {
    if (responseBody === undefined) responseBody = parseBody(body)
    return originalSend(body)
  }

  res.on('finish', () => {
    console.log(JSON.stringify({
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
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
