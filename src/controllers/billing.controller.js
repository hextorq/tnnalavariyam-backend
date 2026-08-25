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

function mergeUserSignupDetails(user, signupRequest) {
  if (!user) return user
  return {
    ...user,
    fullName: signupRequest?.fullName || user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username,
    addressLine: signupRequest?.addressLine || '',
    pincode: signupRequest?.pincode || '',
    state: signupRequest?.state || 'Tamil Nadu',
    district: signupRequest?.district || '',
    taluk: signupRequest?.taluk || '',
    village: signupRequest?.village || '',
  }
}

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
            lastName: true,
            name: true,
            role: true,
            phone: true,
            email: true,
            scope: { select: { id: true, name: true, tamilName: true, englishName: true, type: true, path: true } },
          },
        },
      },
    })

    const users = bills.map((bill) => bill.user).filter(Boolean)
    const userIds = [...new Set(users.map((billUser) => billUser.id).filter(Boolean))]
    const usernames = [...new Set(users.map((billUser) => billUser.username).filter(Boolean))]
    const emails = [...new Set(users.map((billUser) => billUser.email).filter(Boolean))]
    const phones = [...new Set(users.map((billUser) => billUser.phone).filter(Boolean))]
    const signupWhere = [
      userIds.length ? { approvedUserId: { in: userIds } } : null,
      usernames.length ? { username: { in: usernames } } : null,
      emails.length ? { email: { in: emails } } : null,
      phones.length ? { phone: { in: phones } } : null,
    ].filter(Boolean)

    let enrichedBills = bills
    if (signupWhere.length) {
      const signupRequests = await prisma.userSignupRequest.findMany({
        where: { OR: signupWhere },
        select: {
          approvedUserId: true,
          username: true,
          fullName: true,
          email: true,
          phone: true,
          addressLine: true,
          state: true,
          district: true,
          taluk: true,
          village: true,
          pincode: true,
        },
        orderBy: { updatedAt: 'desc' },
      })
      const byApprovedUserId = new Map()
      const byUsername = new Map()
      const byEmail = new Map()
      const byPhone = new Map()
      for (const request of signupRequests) {
        if (request.approvedUserId && !byApprovedUserId.has(request.approvedUserId)) byApprovedUserId.set(request.approvedUserId, request)
        if (request.username && !byUsername.has(request.username)) byUsername.set(request.username, request)
        if (request.email && !byEmail.has(request.email)) byEmail.set(request.email, request)
        if (request.phone && !byPhone.has(request.phone)) byPhone.set(request.phone, request)
      }

      enrichedBills = bills.map((bill) => {
        const billUser = bill.user
        const signupRequest =
          byApprovedUserId.get(billUser?.id) ||
          byUsername.get(billUser?.username) ||
          byEmail.get(billUser?.email) ||
          byPhone.get(billUser?.phone)
        return { ...bill, user: mergeUserSignupDetails(billUser, signupRequest) }
      })
    }

    const geoUnits = await prisma.geoUnit.findMany({
      select: { id: true, name: true, tamilName: true, englishName: true, type: true, parentId: true, path: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    })

    res.json({ bills: enrichedBills, geoUnits })
  } catch (error) {
    next(error)
  }
}

module.exports = { createBill, listBills }
