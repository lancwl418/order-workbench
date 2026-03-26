import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendCustomerEmail } from "@/lib/email";

/**
 * POST /api/exceptions/[id]/email
 *
 * Send an email to the customer about this exception.
 * Body: { subject: string, body: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const exception = await prisma.orderException.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true,
          shopifyOrderNumber: true,
          customerEmail: true,
        },
      },
    },
  });

  if (!exception) {
    return NextResponse.json({ error: "Exception not found" }, { status: 404 });
  }

  const email = exception.order.customerEmail;
  if (!email) {
    return NextResponse.json(
      { error: "No customer email on this order" },
      { status: 400 }
    );
  }

  const { subject, body } = await req.json();
  if (!subject || !body) {
    return NextResponse.json(
      { error: "subject and body are required" },
      { status: 400 }
    );
  }

  const result = await sendCustomerEmail(email, subject, body);

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to send email" },
      { status: 500 }
    );
  }

  const userId = (session.user as unknown as { id: string }).id;

  await prisma.$transaction([
    prisma.orderException.update({
      where: { id },
      data: {
        customerEmailed: true,
        customerEmailedAt: new Date(),
      },
    }),
    prisma.orderLog.create({
      data: {
        orderId: exception.order.id,
        userId,
        action: "customer_emailed",
        message: `Email sent to ${email} re: ${exception.type}`,
        metadata: JSON.parse(
          JSON.stringify({
            exceptionId: id,
            exceptionType: exception.type,
            emailSubject: subject,
            recipientEmail: email,
          })
        ),
      },
    }),
  ]);

  return NextResponse.json({ success: true });
}
