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
