const { AsyncLocalStorage } = require('async_hooks')

const requestStorage = new AsyncLocalStorage()

function requestContext(req, res, next) {
  requestStorage.run({ dbQueryCount: 0, dbTimeMs: 0 }, next)
}

function recordDbQuery(durationMs) {
  const store = requestStorage.getStore()
  if (!store) return
  store.dbQueryCount += 1
  store.dbTimeMs += durationMs
}

function getRequestMetrics() {
  const store = requestStorage.getStore()
  return {
    dbQueryCount: store?.dbQueryCount || 0,
    dbTimeMs: store?.dbTimeMs || 0,
  }
}

module.exports = { getRequestMetrics, recordDbQuery, requestContext }
