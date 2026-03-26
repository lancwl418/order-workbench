type ExceptionEmailParams = {
  type: string;
  customerName: string | null;
  orderNumber: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  dayCount?: number | null;
};

const MESSAGES: Record<string, { subject: string; paragraph: string; reshipPrompt: string }> = {
  NO_MOVEMENT_AFTER_LABEL: {
    subject: "We found a shipping issue with your order #{orderNum}",
    paragraph:
      "We noticed that your package hasn't shown any tracking movement since the label was created. Our team is actively looking into this with the carrier to determine the cause of the delay.",
    reshipPrompt:
      "If the package cannot be located, we would be happy to reship your order at no additional cost. Please let us know if you would like us to proceed with a replacement shipment, or if you'd prefer to wait a bit longer for the original package to update.",
  },
  LONG_TRANSIT: {
    subject: "We found a shipping issue with your order #{orderNum}",
    paragraph:
      "Your package has been in transit longer than expected. We understand how frustrating this can be and want to assure you that we are monitoring the situation closely with the carrier.",
    reshipPrompt:
      "If the package does not arrive within the next few business days, we would like to offer a replacement shipment at no extra charge. Please reply to let us know if you would like us to reship your order, or if you'd prefer to continue waiting.",
  },
  DELIVERY_FAILURE: {
    subject: "Delivery issue with your order #{orderNum} — action needed",
    paragraph:
      "We were notified that there was an issue delivering your package. This may be due to an incorrect address, an access issue, or a carrier problem. We sincerely apologize for the inconvenience.",
    reshipPrompt:
      "We would like to reship your order as soon as possible. Could you please confirm your current shipping address so we can send out a replacement? If you have any updated delivery instructions, please include them in your reply.",
  },
  PRODUCTION_DELAY: {
    subject: "Status update on your order #{orderNum}",
    paragraph:
      "We wanted to let you know that your order is taking a little longer than usual to process. Our production team is working hard to get it completed and shipped out as quickly as possible.",
    reshipPrompt:
      "We expect your order to ship within the next 1–2 business days. If you would prefer a refund or have any special requests, please don't hesitate to let us know.",
  },
};

const DEFAULT_MSG = {
  subject: "Important update regarding your order #{orderNum}",
  paragraph:
    "We wanted to reach out regarding your order. Our team has identified an issue and is working to resolve it as quickly as possible.",
  reshipPrompt:
    "If you would like us to reship your order or if you have any other preferences, please reply to this email and we will take care of it right away.",
};

export function generateExceptionEmail(params: ExceptionEmailParams): {
  subject: string;
  body: string;
} {
  const name = params.customerName || "Valued Customer";
  const orderNum = params.orderNumber || "your recent order";
  const msg = MESSAGES[params.type] || DEFAULT_MSG;

  const subject = msg.subject.replace("{orderNum}", orderNum);

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
    <p style="margin:0 0 16px;">${msg.reshipPrompt}</p>
    <p style="margin:0 0 16px;">If you have any other questions or concerns, feel free to reply directly to this email and we'll be happy to help.</p>
    <p style="margin:0 0 4px;">Best regards,</p>
    <p style="margin:0;color:#555;">Customer Support Team</p>
  </div>
</body>
</html>`.trim();

  return { subject, body };
}

export function appendResponseButtons(htmlBody: string, responseUrl: string): string {
  const buttonsHtml = `
    <div style="margin:24px 0;padding:24px;background:#f8f9fa;border-radius:8px;text-align:center;">
      <p style="margin:0 0 16px;font-size:14px;color:#555;font-weight:600;">
        How would you like us to resolve this?
      </p>
      <div>
        <a href="${responseUrl}?option=reship"
           style="display:inline-block;padding:12px 24px;margin:4px 8px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
          Reship My Order
        </a>
        <a href="${responseUrl}?option=refund"
           style="display:inline-block;padding:12px 24px;margin:4px 8px;background:#059669;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
          Request Refund
        </a>
        <a href="${responseUrl}?option=contact"
           style="display:inline-block;padding:12px 24px;margin:4px 8px;background:#6b7280;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
          Contact Support
        </a>
      </div>
    </div>`;

  // Insert before closing </div></body></html>
  return htmlBody.replace(
    /(<\/div>\s*<\/body>\s*<\/html>)\s*$/i,
    `${buttonsHtml}\n$1`
  );
}
