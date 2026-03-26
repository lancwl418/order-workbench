import { prisma } from "@/lib/prisma";

let angelUserId: string | null | undefined; // undefined = not yet looked up

async function getAngelUserId(): Promise<string | null> {
  if (angelUserId !== undefined) return angelUserId;
  const angel = await prisma.user.findUnique({
    where: { username: "angel" },
    select: { id: true },
  });
  angelUserId = angel?.id ?? null;
  return angelUserId;
}

/**
 * Notify Angel when an order is CS-flagged.
 * Skips if Angel is the one who flagged it (no self-notification).
 */
export async function notifyAngelCsFlagged(
  orderId: string,
  orderNumber: string,
  fromUserId?: string,
  fromName?: string
): Promise<void> {
  const angelId = await getAngelUserId();
  if (!angelId) return;
  if (fromUserId && fromUserId === angelId) return;

  const who = fromName || "Someone";
  await prisma.notification.create({
    data: {
      userId: angelId,
      type: "cs_flagged",
      message: `${who} flagged order #${orderNumber} for CS`,
      orderId,
      fromUserId: fromUserId ?? null,
    },
  });
}
