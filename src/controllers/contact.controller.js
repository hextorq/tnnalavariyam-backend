const { z } = require('zod')
const prisma = require('../config/prisma')

const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  message: z.string().min(1),
})

async function createContactMessage(req, res, next) {
  try {
    const data = contactSchema.parse(req.body)
    const message = await prisma.contactMessage.create({ data })
    res.status(201).json({ message })
  } catch (error) {
    next(error)
  }
}

module.exports = { createContactMessage }
