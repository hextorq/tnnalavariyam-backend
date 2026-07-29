require('dotenv').config()

const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const morgan = require('morgan')
const path = require('path')
const { frontendOrigin, uploadDir } = require('./config/env')
const routes = require('./routes')
const { errorHandler, notFoundHandler } = require('./middleware/errorHandlers')

const app = express()

app.use(helmet())
app.use(cors({ origin: frontendOrigin, credentials: true }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'))
app.use('/uploads', express.static(path.resolve(uploadDir)))

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'tn-nalavaariyam-api' })
})

app.use('/api', routes)
app.use(notFoundHandler)
app.use(errorHandler)

module.exports = app
