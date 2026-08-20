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

  const hashedPassword = await bcrypt.hash('admin123', 12)

  await prisma.user.upsert({
    where: { email: 'admin@otomate.local' },
    update: {},
    create: {
      email: 'admin@otomate.local',
      password: hashedPassword,
      name: 'Admin',
      roleId: adminRole.id,
      branchId: hq.id,
    },
  })

  console.log('Seed complete. Admin: admin@otomate.local / admin123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
