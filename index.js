const express = require('express')
const app = require('./src/app')
const { port } = require('./src/config/env')
const { migrateLegacyBase64Images } = require('./src/utils/legacyImageMigration')

const server = express()

server.get('/', (req, res) => {
  res.send('TN Nalavaariyam API running on port ' + port)
})

server.use(app)

server.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${port}`)
  migrateLegacyBase64Images()
})
