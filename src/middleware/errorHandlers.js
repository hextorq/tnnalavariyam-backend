function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Route not found' })
}

function errorHandler(error, req, res, next) {
  if (error.name === 'ZodError') {
    return res.status(400).json({ message: 'Validation failed', issues: error.issues })
  }

  const statusCode = error.statusCode || error.status
  if (statusCode && statusCode < 500) {
    return res.status(statusCode).json({ message: error.message })
  }

  console.error(error)
  const detail =
    process.env.NODE_ENV === 'production'
      ? undefined
      : { error: error.message, stack: error.stack?.split('\n').slice(0, 6) }
  res.status(500).json({ message: 'Internal server error', ...detail })
}

module.exports = { notFoundHandler, errorHandler }
