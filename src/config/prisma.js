const { PrismaClient } = require('@prisma/client')
const { recordDbQuery } = require('../services/requestContext')

const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const startedAt = Date.now()
        try {
          return await query(args)
        } finally {
          recordDbQuery(Date.now() - startedAt)
        }
      },
    },
  },
})

module.exports = prisma
