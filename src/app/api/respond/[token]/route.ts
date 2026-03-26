import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = ["RESHIP", "REFUND", "CONTACT_SUPPORT"] as const;

/**
 * POST /api/respond/[token]
 *
 * Public endpoint — no auth required.
 * Customer submits their response to a shipping exception.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const response = await prisma.exceptionResponse.findUnique({
    where: { token },
    include: {
      exception: {
        select: { orderId: true },
      },
    },
  });

  if (!response) {
    return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  }

  if (response.respondedAt) {
    return NextResponse.json(
      { error: "already_responded" },
      { status: 409 }
    );
  }

  const body = await req.json();
  const { responseType, needByDate, noRush, comments } = body;

  if (!responseType || !VALID_TYPES.includes(responseType)) {
    return NextResponse.json(
      { error: "Invalid responseType" },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.exceptionResponse.update({
      where: { token },
      data: {
        responseType,
        needByDate: responseType === "RESHIP" && needByDate ? new Date(needByDate) : null,
        noRush: responseType === "RESHIP" ? !!noRush : false,
        comments: comments || null,
        respondedAt: new Date(),
      },
    }),
    prisma.orderLog.create({
      data: {
        orderId: response.exception.orderId,
        action: "customer_responded",
        message: `Customer chose: ${responseType}${comments ? ` — "${comments}"` : ""}`,
        metadata: JSON.parse(
          JSON.stringify({
            responseType,
            needByDate: needByDate || null,
            noRush: !!noRush,
          })
        ),
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}
