/**
 * Maintenance script: reset product data for a fresh launch.
 *
 * Deletes:
 *   - Application reviews, documents, submissions
 *   - Bill receipts
 *   - Signup requests
 *   - Contact messages
 *   - Audit logs
 *   - All users except the preserved admin username
 *   - Runtime upload files under uploads/applications and uploads/signup
 *
 * Keeps:
 *   - User with username "hextorqadmin" by default
 *   - GeoUnit hierarchy
 *   - ApplicationForm templates
 *
 * Usage:
 *   npm run reset:fresh                 # dry-run
 *   npm run reset:fresh -- --yes        # delete, preserving hextorqadmin
 *   npm run reset:fresh -- --yes --keep=otheradmin
 */
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const YES = process.argv.includes('--yes')
const keepArg = process.argv.find((arg) => arg.startsWith('--keep='))
const KEEP_USERNAME = (keepArg ? keepArg.split('=').slice(1).join('=') : 'hextorqadmin').trim()

function removeDirContents(dirPath) {
  if (!fs.existsSync(dirPath)) return 0
  const entries = fs.readdirSync(dirPath)
  for (const entry of entries) {
    fs.rmSync(path.join(dirPath, entry), { recursive: true, force: true })
  }
  return entries.length
}

async function countAll(keepUserId) {
  return {
    usersToDelete: await prisma.user.count({ where: { id: { not: keepUserId } } }),
    usersKept: await prisma.user.count({ where: { id: keepUserId } }),
    signupRequests: await prisma.userSignupRequest.count(),
    submissions: await prisma.applicationSubmission.count(),
    reviews: await prisma.applicationReview.count(),
    documents: await prisma.uploadedDocument.count(),
    bills: await prisma.bill.count(),
    contactMessages: await prisma.contactMessage.count(),
    auditLogs: await prisma.auditLog.count(),
    geoUnits: await prisma.geoUnit.count(),
    forms: await prisma.applicationForm.count(),
  }
}

function printCounts(title, counts) {
  console.log(`\n${title}`)
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key}: ${value}`)
  }
}

async function resetAutoIncrement(tableName) {
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${tableName}\` AUTO_INCREMENT = 1`)
}

async function main() {
  if (!KEEP_USERNAME) throw new Error('Preserved username is required')

  const keepUser = await prisma.user.findUnique({
    where: { username: KEEP_USERNAME },
    select: { id: true, username: true, email: true, role: true, isActive: true },
  })

  if (!keepUser) {
    throw new Error(`Preserved user "${KEEP_USERNAME}" was not found. Aborting so all users are not deleted accidentally.`)
  }

  console.log('Fresh product reset target:')
  console.log(keepUser)

  const before = await countAll(keepUser.id)
  printCounts('Before reset:', before)

  if (!YES) {
    console.log('\nDry run only. Re-run with --yes to permanently delete this data.')
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.applicationReview.deleteMany({})
    await tx.uploadedDocument.deleteMany({})
    await tx.applicationSubmission.deleteMany({})
    await tx.bill.deleteMany({})
    await tx.auditLog.deleteMany({})
    await tx.userSignupRequest.deleteMany({})
    await tx.contactMessage.deleteMany({})
    await tx.user.deleteMany({ where: { id: { not: keepUser.id } } })
    await tx.user.update({
      where: { id: keepUser.id },
      data: {
        isActive: true,
        lastLoginAt: null,
      },
    })
  })

  const uploadRoot = path.resolve(__dirname, '../../uploads')
  const removedApplicationEntries = removeDirContents(path.join(uploadRoot, 'applications'))
  const removedSignupEntries = removeDirContents(path.join(uploadRoot, 'signup'))

  for (const table of [
    'ApplicationReview',
    'UploadedDocument',
    'ApplicationSubmission',
    'Bill',
    'AuditLog',
    'UserSignupRequest',
    'ContactMessage',
  ]) {
    try {
      await resetAutoIncrement(table)
    } catch (error) {
      console.warn(`[auto-increment] skipped ${table}: ${error.message}`)
    }
  }

  const after = await countAll(keepUser.id)
  printCounts('After reset:', after)
  console.log(`\nRemoved uploads/applications entries: ${removedApplicationEntries}`)
  console.log(`Removed uploads/signup entries: ${removedSignupEntries}`)
  console.log(`\nDone. Preserved user: ${KEEP_USERNAME}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
