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

const allowedOrigins = [
  'https://tnnalavariyam-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4000',
  frontendOrigin,
].filter(Boolean)

function isOriginAllowed(origin) {
  if (!origin) return true
  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return true
  if (/\.vercel\.app$/i.test(origin)) return true
  return true // Allow all origins for seamless production access
}

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin')
    res.setHeader('Timing-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Timing-Allow-Origin', '*')
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  next()
})

app.use(requestContext)
app.use(requestLogger)
app.use(helmet({ crossOriginResourcePolicy: false }))
app.use(
  cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  })
)

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))
app.use('/uploads', express.static(path.resolve(uploadDir)))
app.use('/api/uploads', express.static(path.resolve(uploadDir)))

app.get('/health', healthCheck)

app.use('/api', routes)
app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app
