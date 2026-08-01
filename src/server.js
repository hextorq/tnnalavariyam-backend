const app = require('./app')
const { port } = require('./config/env')
const { migrateLegacyBase64Images } = require('./utils/legacyImageMigration')

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`)
  migrateLegacyBase64Images()
})
