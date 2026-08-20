import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const permissions = await Promise.all([
    prisma.permission.upsert({ where: { name: 'users:read' }, update: {}, create: { name: 'users:read' } }),
    prisma.permission.upsert({ where: { name: 'users:write' }, update: {}, create: { name: 'users:write' } }),
    prisma.permission.upsert({ where: { name: 'reports:read' }, update: {}, create: { name: 'reports:read' } }),
  ])

  const [usersRead, usersWrite, reportsRead] = permissions

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', permissions: { connect: permissions.map(p => ({ id: p.id })) } },
  })

  await prisma.role.upsert({
    where: { name: 'branch_manager' },
    update: {},
    create: { name: 'branch_manager', permissions: { connect: [{ id: usersRead.id }, { id: reportsRead.id }] } },
  })

  await prisma.role.upsert({
    where: { name: 'staff' },
    update: {},
    create: { name: 'staff', permissions: { connect: [{ id: usersRead.id }] } },
  })

  const hq = await prisma.branch.upsert({
    where: { id: 'hq' },
    update: {},
    create: { id: 'hq', name: 'HQ' },
  })

  // Only create admin if it doesn't exist — never overwrite an existing password
  const existingAdmin = await prisma.user.findUnique({ where: { email: 'admin@otomate.local' } })
  if (!existingAdmin) {
    const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-immediately'
    const hashedPassword = await bcrypt.hash(seedPassword, 12)
    await prisma.user.create({
      data: {
        email: 'admin@otomate.local',
        password: hashedPassword,
        name: 'Admin',
        roleId: adminRole.id,
        branchId: hq.id,
      },
    })
    console.log(`Seed complete. Admin created: admin@otomate.local (password from SEED_ADMIN_PASSWORD env var, or 'change-me-immediately')`)
  } else {
    console.log('Seed complete. Admin already exists — password NOT changed.')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
