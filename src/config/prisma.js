const { PrismaClient } = require('@prisma/client')
const { recordDbQuery } = require('../services/requestContext')

const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const startedAt = performance.now()
        try {
          return await query(args)
        } finally {
          recordDbQuery(performance.now() - startedAt, { model, operation })
        }
      },
    },
  },
})

module.exports = prisma
