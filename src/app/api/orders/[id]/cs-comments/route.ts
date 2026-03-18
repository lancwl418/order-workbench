import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createCommentSchema = z.object({
  content: z.string().min(1),
  attachments: z.array(z.string()).optional(),
  mentions: z.array(z.string()).optional(), // user IDs
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const comments = await prisma.csComment.findMany({
    where: { orderId: id },
    include: {
      user: { select: { displayName: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(comments);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = createCommentSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const mentions = parsed.data.mentions || [];

  // Auto-set csFlag + REVIEW status when comment is added
  const needsFlag = !order.csFlag;
  const orderUpdateData: Record<string, unknown> = {
    csNote: parsed.data.content,
  };
  if (needsFlag) {
    orderUpdateData.csFlag = true;
    orderUpdateData.internalStatus = "REVIEW";
  }

  const [comment] = await prisma.$transaction([
    prisma.csComment.create({
      data: {
        orderId: id,
        userId: session.user?.id,
        content: parsed.data.content,
        attachments: parsed.data.attachments || [],
        mentions,
      },
      include: {
        user: { select: { displayName: true, username: true } },
      },
    }),
    // Denormalize latest comment + auto-flag for CS
    prisma.order.update({
      where: { id },
      data: orderUpdateData,
    }),
  ]);

  // Log csFlag change
  if (needsFlag) {
    await prisma.orderLog.create({
      data: {
        orderId: id,
        userId: session.user?.id,
        action: "cs_flagged",
        fromValue: order.internalStatus,
        toValue: "REVIEW",
        message: "Auto-flagged by comment",
      },
    });
  }

  // Create notifications for mentioned users
  if (mentions.length > 0) {
    const fromName =
      session.user?.name || session.user?.email || "Someone";
    const orderNumber = order.shopifyOrderNumber || id.slice(0, 8);

    await prisma.notification.createMany({
      data: mentions
        .filter((uid) => uid !== session.user?.id) // don't notify yourself
        .map((uid) => ({
          userId: uid,
          type: "mention",
          message: `${fromName} mentioned you on order #${orderNumber}`,
          orderId: id,
          commentId: comment.id,
          fromUserId: session.user?.id,
        })),
    });
  }

  return NextResponse.json(comment, { status: 201 });
}
