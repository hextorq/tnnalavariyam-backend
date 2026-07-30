const { AsyncLocalStorage } = require('async_hooks')

const requestStorage = new AsyncLocalStorage()

function requestContext(req, res, next) {
  requestStorage.run({ dbQueries: [], dbQueryCount: 0, dbTimeMs: 0 }, next)
}

function roundMs(value) {
  return Math.round(value * 100) / 100
}

function recordDbQuery(durationMs, details = {}) {
  const store = requestStorage.getStore()
  if (!store) return
  store.dbQueryCount += 1
  store.dbTimeMs += roundMs(durationMs)
  store.dbQueries.push({
    model: details.model || null,
    operation: details.operation || null,
    durationMs: roundMs(durationMs),
  })
}

function getRequestMetrics() {
  const store = requestStorage.getStore()
  return {
    dbQueryCount: store?.dbQueryCount || 0,
    dbTimeMs: roundMs(store?.dbTimeMs || 0),
    dbQueries: store?.dbQueries || [],
  }
}

module.exports = { getRequestMetrics, recordDbQuery, requestContext }
