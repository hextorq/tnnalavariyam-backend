const { z } = require('zod')
const prisma = require('../config/prisma')
const { isAdminRole } = require('../services/rbac.service')

const billItemSchema = z.object({
  particulars: z.string().trim().min(1, 'Particulars is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  amount: z.number().positive('Amount must be greater than zero'),
})

const createBillSchema = z.object({
  items: z.array(billItemSchema).min(1, 'At least one bill entry is required'),
})

async function generateBillNo() {
  const last = await prisma.bill.findFirst({
    orderBy: { id: 'desc' },
    select: { id: true },
  })
  const year = new Date().getFullYear()
  const seq = (last?.id || 0) + 1
  return `TNRB-${year}-${String(seq).padStart(4, '0')}`
}

async function createBill(req, res, next) {
  try {
    const data = createBillSchema.parse(req.body)

    const items = data.items.map((item) => ({
      particulars: String(item.particulars).trim(),
      quantity: Number(item.quantity),
      amount: Number(item.amount),
    }))

    const totalRaw = items.reduce((sum, item) => sum + item.amount, 0)
    const totalAmount = Math.round(totalRaw * 100) / 100

    const billNo = await generateBillNo()

    const bill = await prisma.bill.create({
      data: {
        billNo,
        userId: req.user.id,
        items,
        totalAmount,
      },
      select: {
        id: true,
        billNo: true,
        userId: true,
        items: true,
        totalAmount: true,
        createdAt: true,
      },
    })

    res.status(201).json({ message: 'Bill created successfully / பில் வெற்றிகரமாக உருவாக்கப்பட்டது', bill })
  } catch (error) {
    next(error)
  }
}

async function listBills(req, res, next) {
  try {
    const user = req.user

    let where
    if (user.role === 'SUPER_ADMIN' || (user.role === 'STATE_ADMIN' && !user.scopeId)) {
      where = {}
    } else if (isAdminRole(user.role) && user.scope) {
      where = {
        OR: [
          { userId: user.id },
          { user: { is: { scopeId: user.scopeId } } },
          { user: { is: { scope: { is: { path: { startsWith: `${user.scope.path}${user.scope.id}/` } } } } } },
        ],
      }
    } else {
      where = { userId: user.id }
    }

    const bills = await prisma.bill.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        billNo: true,
        userId: true,
        items: true,
        totalAmount: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            name: true,
            role: true,
            phone: true,
            email: true,
            scope: { select: { id: true, name: true, tamilName: true, type: true, path: true } },
          },
        },
      },
    })
    res.json({ bills })
  } catch (error) {
    next(error)
  }
}

module.exports = { createBill, listBills }
