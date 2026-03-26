type ExceptionEmailParams = {
  type: string;
  customerName: string | null;
  orderNumber: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  dayCount?: number | null;
};

const MESSAGES: Record<string, { subjectSuffix: string; paragraph: string }> = {
  NO_MOVEMENT_AFTER_LABEL: {
    subjectSuffix: "Shipping Update",
    paragraph:
      "We noticed that your package hasn't shown any tracking movement yet. Please know that we are looking into this and will ensure your order reaches you as soon as possible. In some cases, there may be a short delay before the carrier scans the package into their system.",
  },
  LONG_TRANSIT: {
    subjectSuffix: "Shipping Update",
    paragraph:
      "Your package has been in transit longer than expected. We understand this can be frustrating and want to assure you that we are monitoring the situation closely. If the package does not arrive within the next few business days, we will take further action to resolve this for you.",
  },
  DELIVERY_FAILURE: {
    subjectSuffix: "Delivery Issue",
    paragraph:
      "We were notified that there was an issue delivering your package. This may be due to an incorrect address, an access issue, or a carrier problem. We are looking into this and will reach out with next steps shortly. If you have any updated delivery instructions, please reply to this email.",
  },
  PRODUCTION_DELAY: {
    subjectSuffix: "Order Status Update",
    paragraph:
      "We wanted to let you know that your order is taking a little longer than usual to process. Our team is working to get it shipped out as quickly as possible. We appreciate your patience and will send you a tracking number as soon as your order is on its way.",
  },
};

const DEFAULT_MSG = {
  subjectSuffix: "Order Update",
  paragraph:
    "We wanted to reach out regarding your order. Our team is looking into an issue and will keep you updated. If you have any questions, please don't hesitate to reply to this email.",
};

export function generateExceptionEmail(params: ExceptionEmailParams): {
  subject: string;
  body: string;
} {
  const name = params.customerName || "Valued Customer";
  const orderNum = params.orderNumber || "your recent order";
  const msg = MESSAGES[params.type] || DEFAULT_MSG;

  const subject = `Order #${orderNum} — ${msg.subjectSuffix}`;

  const trackingSection =
    params.trackingNumber
      ? `<p style="margin:0 0 16px;color:#555;">
           <strong>Tracking:</strong> ${params.carrier ? params.carrier + " — " : ""}${params.trackingNumber}
         </p>`
      : "";

  const body = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <p style="margin:0 0 16px;">Hi ${name},</p>
    <p style="margin:0 0 16px;">Thank you for your order <strong>#${orderNum}</strong>.</p>
    <p style="margin:0 0 16px;">${msg.paragraph}</p>
    ${trackingSection}
    <p style="margin:0 0 16px;">If you have any questions or concerns, feel free to reply directly to this email and we'll be happy to help.</p>
    <p style="margin:0 0 4px;">Best regards,</p>
    <p style="margin:0;color:#555;">Customer Support Team</p>
  </div>
</body>
</html>`.trim();

  return { subject, body };
}
