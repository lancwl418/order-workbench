import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash("Imissu4ever!", 12);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: { hashedPassword: adminPassword },
    create: {
      username: "admin",
      hashedPassword: adminPassword,
      displayName: "Admin",
      role: "admin",
      isActive: true,
    },
  });
  console.log(`Seeded user: ${admin.username} (id: ${admin.id})`);

  const users = [
    { username: "lyn", displayName: "Lyn", role: "user" as const },
    { username: "rob", displayName: "Rob", role: "user" as const },
    { username: "wesley", displayName: "Wesley", role: "user" as const },
    { username: "rock", displayName: "Rock", role: "user" as const },
    { username: "angel", displayName: "Angel", role: "user" as const },
    { username: "long", displayName: "Long", role: "user" as const },
  ];

  for (const u of users) {
    const pw = await bcrypt.hash(`IdeaMax${u.displayName}`, 12);
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { hashedPassword: pw },
      create: {
        username: u.username,
        hashedPassword: pw,
        displayName: u.displayName,
        role: u.role,
        isActive: true,
      },
    });
    console.log(`Seeded user: ${user.username} (id: ${user.id})`);
  }

  const suppliers = [
    {
      key: "linmiao",
      name: "Linmiao",
      adapterType: "linmiao",
      secretKeyEnv: "FACTORY_API_SECRET_KEY",
    },
    {
      key: "jjspromo",
      name: "JJSPROMO",
      adapterType: "riin",
      secretKeyEnv: "RIIN_JJSPROMO_SECRET_KEY",
    },
    {
      key: "xinfeiyang",
      name: "Xinfeiyang",
      adapterType: "riin",
      secretKeyEnv: "RIIN_XINFEIYANG_SECRET_KEY",
    },
  ];

  for (const s of suppliers) {
    const supplier = await prisma.supplier.upsert({
      where: { key: s.key },
      update: { adapterType: s.adapterType, secretKeyEnv: s.secretKeyEnv },
      create: s,
    });
    console.log(`Seeded supplier: ${supplier.key} (id: ${supplier.id})`);
  }

  // SkuMappings created before multi-supplier all came from linmiao pushes.
  const linmiao = await prisma.supplier.findUnique({ where: { key: "linmiao" } });
  if (linmiao) {
    const backfilled = await prisma.skuMapping.updateMany({
      where: { supplierId: null },
      data: { supplierId: linmiao.id },
    });
    if (backfilled.count > 0) {
      console.log(`Backfilled ${backfilled.count} sku mappings to linmiao`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
