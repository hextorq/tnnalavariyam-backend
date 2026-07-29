const prisma = require('../config/prisma')
const tamilNaduHierarchy = require('../data/tamilNaduHierarchy.json')

async function upsertGeoUnit({ name, tamilName, type, code, parentId, path }) {
  return prisma.geoUnit.upsert({
    where: { code },
    update: { name, tamilName, type, parentId, path },
    create: { name, tamilName, type, code, parentId, path },
  })
}

async function seedTamilNaduHierarchy() {
  const state = await upsertGeoUnit({
    name: tamilNaduHierarchy.englishName,
    tamilName: tamilNaduHierarchy.name,
    type: 'STATE',
    code: `STATE-${tamilNaduHierarchy.code}`,
    parentId: null,
    path: '/',
  })

  let districtCount = 0
  let talukCount = 0
  let villageCount = 0

  for (const district of tamilNaduHierarchy.districts) {
    const districtUnit = await upsertGeoUnit({
      name: district.name,
      tamilName: district.name,
      type: 'DISTRICT',
      code: `DISTRICT-${district.code}`,
      parentId: state.id,
      path: `${state.path}${state.id}/`,
    })
    districtCount += 1

    for (const taluk of district.taluks) {
      const talukUnit = await upsertGeoUnit({
        name: taluk.name,
        tamilName: taluk.name,
        type: 'TALUK',
        code: `TALUK-${taluk.code}`,
        parentId: districtUnit.id,
        path: `${districtUnit.path}${districtUnit.id}/`,
      })
      talukCount += 1

      for (const village of taluk.villages) {
        await upsertGeoUnit({
          name: village.name,
          tamilName: village.name,
          type: 'VILLAGE',
          code: `VILLAGE-${village.code}`,
          parentId: talukUnit.id,
          path: `${talukUnit.path}${talukUnit.id}/`,
        })
        villageCount += 1
      }
    }
  }

  console.log({ state: 1, districts: districtCount, taluks: talukCount, villages: villageCount })
}

seedTamilNaduHierarchy()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
