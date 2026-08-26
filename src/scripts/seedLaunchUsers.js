require('dotenv').config()

const bcrypt = require('bcryptjs')
const prisma = require('../config/prisma')

const password = 'Tnnalavariyam@2026.'

const users = [
  {
    username: 'tsdcsecretary',
    email: 'tsdcsecretary@tnnalavariyam.com',
    name: 'TSDC Secretary',
    firstName: 'TSDC',
    lastName: 'Secretary',
    role: 'SUPER_ADMIN',
    scopeId: null,
  },
  {
    username: 'tsdcpresident',
    email: 'tsdcpresident@tnnalavariyam.com',
    name: 'TSDC President',
    firstName: 'TSDC',
    lastName: 'President',
    role: 'SUPER_ADMIN',
    scopeId: null,
  },
  {
    username: 'tnadmin',
    email: 'tnadmin@tnnalavariyam.com',
    name: 'Tamil Nadu Admin',
    firstName: 'Tamil Nadu',
    lastName: 'Admin',
    role: 'STATE_ADMIN',
    scopeId: 'STATE_SCOPE',
  },
]

async function findTamilNaduStateScope() {
  return prisma.geoUnit.findFirst({
    where: {
      type: 'STATE',
      OR: [
        { name: { contains: 'Tamil' } },
        { englishName: { contains: 'Tamil' } },
        { tamilName: { contains: 'தமிழ்' } },
      ],
    },
    orderBy: { id: 'asc' },
  })
}

async function upsertUser(user, passwordHash, stateScope) {
  const scopeId = user.scopeId === 'STATE_SCOPE' ? stateScope.id : user.scopeId
  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username: user.username }, { email: user.email }],
    },
    select: { id: true, username: true },
  })

  const data = {
    username: user.username,
    email: user.email,
    phone: null,
    passwordHash,
    role: user.role,
    scopeId,
    isActive: true,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    lastLoginAt: null,
  }

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data,
      select: { id: true, username: true, email: true, role: true, scopeId: true, isActive: true },
    })
  }

  return prisma.user.create({
    data,
    select: { id: true, username: true, email: true, role: true, scopeId: true, isActive: true },
  })
}

async function main() {
  const stateScope = await findTamilNaduStateScope()
  if (!stateScope) {
    throw new Error('Tamil Nadu state scope was not found. Seed geo hierarchy before creating tnadmin.')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const seeded = []
  for (const user of users) {
    seeded.push(await upsertUser(user, passwordHash, stateScope))
  }

  console.log({
    message: 'Launch users seeded',
    stateScope: {
      id: stateScope.id,
      name: stateScope.name,
      tamilName: stateScope.tamilName,
      englishName: stateScope.englishName,
    },
    users: seeded,
    login: {
      usernames: users.map((user) => user.username),
      password,
    },
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
