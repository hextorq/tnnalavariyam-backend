/**
 * Maintenance script: delete ALL application data.
 *
 * Deletes (in FK-safe order):
 *   - ApplicationReview
 *   - UploadedDocument (rows)
 *   - ApplicationSubmission
 *   - migrated document files under uploads/applications/
 *
 * KEEPS: User, UserSignupRequest, GeoUnit, ApplicationForm (form templates),
 *        ContactMessage, AuditLog.
 *
 * Usage:
 *   npm run clear:applications            # dry-run: prints counts only
 *   npm run clear:applications -- --yes   # actually deletes
 */
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

const YES = process.argv.includes('--yes')

async function main() {
  const counts = {
    submission: await prisma.applicationSubmission.count(),
    review: await prisma.applicationReview.count(),
    document: await prisma.uploadedDocument.count(),
  }
  console.log('Application data found:')
  console.log(`  ApplicationSubmission: ${counts.submission}`)
  console.log(`  ApplicationReview:     ${counts.review}`)
  console.log(`  UploadedDocument:      ${counts.document}`)

  if (!YES) {
    console.log('\nDry run — nothing deleted. Re-run with --yes to delete.')
    return
  }

  await prisma.applicationReview.deleteMany({})
  await prisma.uploadedDocument.deleteMany({})
  await prisma.applicationSubmission.deleteMany({})

  const uploadsDir = path.resolve(__dirname, '../../uploads/applications')
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir, { recursive: true })
    fs.rmSync(uploadsDir, { recursive: true, force: true })
    console.log(`\nRemoved uploads/applications/ (${files.length} entries)`)
  }

  const after = {
    submission: await prisma.applicationSubmission.count(),
    review: await prisma.applicationReview.count(),
    document: await prisma.uploadedDocument.count(),
  }
  console.log('\nAfter cleanup:')
  console.log(`  ApplicationSubmission: ${after.submission}`)
  console.log(`  ApplicationReview:     ${after.review}`)
  console.log(`  UploadedDocument:      ${after.document}`)
  console.log('\nDone. Users and form templates untouched.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
