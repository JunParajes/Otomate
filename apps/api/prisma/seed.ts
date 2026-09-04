import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { PERMISSIONS, PERMISSION_NAMES, SUPER_ADMIN_ROLE } from '@otomate/shared'

const prisma = new PrismaClient()

const ADMIN_EMAIL = 'admin@otomate.local'

async function main() {
  // ── 1. Sync the permission catalog ──────────────────────────────────────
  // packages/shared is the source of truth; the table mirrors it.
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: p.name },
      update: { category: p.category, description: p.description },
      create: { name: p.name, category: p.category, description: p.description },
    })
  }

  const orphans = await prisma.permission.findMany({
    where: { name: { notIn: [...PERMISSION_NAMES] } },
  })
  if (orphans.length > 0) {
    await prisma.permission.deleteMany({ where: { id: { in: orphans.map(o => o.id) } } })
    console.log(`Removed ${orphans.length} permission(s) no longer in the catalog: ${orphans.map(o => o.name).join(', ')}`)
  }

  const allPermissions = await prisma.permission.findMany()
  console.log(`Permission catalog synced (${allPermissions.length} permissions).`)

  // ── 2. Super Admin role — holds everything, protected from the GUI ───────
  const superAdmin = await prisma.role.upsert({
    where: { name: SUPER_ADMIN_ROLE },
    update: {
      isSystem: true,
      description: 'Full system access. Cannot be edited or deleted.',
      permissions: { set: allPermissions.map(p => ({ id: p.id })) },
    },
    create: {
      name: SUPER_ADMIN_ROLE,
      isSystem: true,
      description: 'Full system access. Cannot be edited or deleted.',
      permissions: { connect: allPermissions.map(p => ({ id: p.id })) },
    },
  })
  console.log(`Role '${SUPER_ADMIN_ROLE}' ready with all ${allPermissions.length} permissions.`)

  // ── 3. Somewhere to put the first account ───────────────────────────────
  //
  // "HQ" exists so a brand-new install has a branch to attach the owner to. It
  // is NOT a place — the bakery has Bankerohan, Panacan, Sasa and the rest.
  //
  // It used to be upserted unconditionally, and since the seed runs on EVERY
  // deploy it came back every time. That was invisible while the branch list was
  // scaffolding; once the real twelve were imported, an empty thirteenth branch
  // reappeared after each deploy and had to be deleted again — and it shows up
  // in the schedule's branch list and every branch picker in between.
  //
  // Bootstrap only, therefore: created when there are no branches at all, and
  // never re-created once the real ones exist. Same shape as the super-admin
  // guard below — the seed's job is to stop the system being unusable, not to
  // keep asserting its opinion over what someone has since set up.
  const branchCount = await prisma.branch.count()
  const hq = branchCount === 0
    ? await prisma.branch.create({ data: { name: 'HQ' } })
    : await prisma.branch.findFirst({ orderBy: { name: 'asc' } })

  // ── 4. The owner account ────────────────────────────────────────────────
  const existing = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    include: { role: true },
  })

  if (!existing) {
    const seedPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-immediately'
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        password: await bcrypt.hash(seedPassword, 12),
        name: 'Admin',
        roleId: superAdmin.id,
        // Optional on User, so a seed run against an empty branch list is fine.
        branchId: hq?.id ?? null,
        mustChangePassword: seedPassword === 'change-me-immediately',
      },
    })
    console.log(`Created ${ADMIN_EMAIL} as ${SUPER_ADMIN_ROLE} (password from SEED_ADMIN_PASSWORD, or 'change-me-immediately').`)
  } else if (existing.role.name !== SUPER_ADMIN_ROLE) {
    // This account's role is only forced back when doing so is the difference
    // between having a super admin and having none.
    //
    // The promotion used to be unconditional, which was fine while the seed ran
    // by hand. Since 2026-08-30 it runs on EVERY deploy (to sync the permission
    // catalog), and unconditional promotion silently undid a deliberate change
    // made in the admin UI — admin@otomate.local was set to human_resource and
    // was back to super_admin after the next deploy, with nothing to show why.
    //
    // The guard this exists for is "never leave the system with no super admin".
    // Another active super admin satisfies that, so the demotion is respected.
    const otherSuperAdmins = await prisma.user.count({
      where: { role: { name: SUPER_ADMIN_ROLE }, id: { not: existing.id }, isActive: true },
    })

    if (otherSuperAdmins > 0) {
      console.log(
        `${ADMIN_EMAIL} is '${existing.role.name}', left alone — ` +
          `${otherSuperAdmins} other active ${SUPER_ADMIN_ROLE}(s) exist.`
      )
    } else {
      await prisma.user.update({ where: { id: existing.id }, data: { roleId: superAdmin.id } })
      console.log(
        `Promoted ${ADMIN_EMAIL} from '${existing.role.name}' to ${SUPER_ADMIN_ROLE}: ` +
          `it was the only account that could hold that role. Password unchanged.`
      )
    }
  } else {
    console.log(`${ADMIN_EMAIL} is already ${SUPER_ADMIN_ROLE}. Password unchanged.`)
  }

  // Legacy seeded roles (admin/branch_manager/staff) are intentionally left in
  // place rather than deleted — they may have users attached. Remove them from
  // the GUI once their users are reassigned.
  const legacy = await prisma.role.findMany({
    where: { name: { in: ['admin', 'branch_manager', 'staff'] } },
    include: { _count: { select: { users: true } } },
  })
  for (const r of legacy) {
    console.log(`  legacy role '${r.name}' still present (${r._count.users} user(s)) — delete via the GUI when ready.`)
  }
}

main()
  .then(() => console.log('Seed complete.'))
  .catch(e => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
