const bcrypt = require('bcryptjs')
const prisma = require('../config/prisma')

const credentials = {
  username: process.env.SUPER_ADMIN_USERNAME || 'superadmin',
  email: process.env.SUPER_ADMIN_EMAIL || 'admin@tnnalavariyam.com',
  phone: process.env.SUPER_ADMIN_PHONE || '9000000001',
  password: process.env.SUPER_ADMIN_PASSWORD || 'Admin@12345',
  name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
}

async function seedSuperAdmin() {
  const passwordHash = await bcrypt.hash(credentials.password, 12)
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username: credentials.username },
        { email: credentials.email },
        { phone: credentials.phone },
      ],
    },
  })

  const data = {
    username: credentials.username,
    email: credentials.email,
    phone: credentials.phone,
    passwordHash,
    role: 'SUPER_ADMIN',
    scopeId: null,
    isActive: true,
    name: credentials.name,
    firstName: 'Super',
    lastName: 'Admin',
  }

  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data,
        select: { id: true, username: true, email: true, phone: true, role: true, isActive: true },
      })
    : await prisma.user.create({
        data,
        select: { id: true, username: true, email: true, phone: true, role: true, isActive: true },
      })

  console.log({
    message: existingUser ? 'Super admin updated' : 'Super admin created',
    user,
    login: {
      identifier: credentials.username,
      password: credentials.password,
    },
  })
}

seedSuperAdmin()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
