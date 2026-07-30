require('dotenv').config()

const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const path = require('path')
const { frontendOrigin, uploadDir } = require('./config/env')
const routes = require('./routes')
const { healthCheck } = require('./controllers/health.controller')
const { errorHandler, notFoundHandler } = require('./middleware/errorHandlers')
const { requestLogger } = require('./middleware/requestLogger')
const { requestContext } = require('./services/requestContext')

const app = express()

app.use(helmet())
app.use(cors({ origin: frontendOrigin, credentials: true }))
app.use(requestContext)
app.use(requestLogger)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(path.resolve(uploadDir)))

app.get('/health', healthCheck)

app.use('/api', routes)
app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app
