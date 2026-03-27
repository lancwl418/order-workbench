import { describe, it, expect } from "vitest";
import { generateExceptionEmail, appendResponseButtons } from "@/lib/email-templates";

describe("generateExceptionEmail", () => {
  it("generates email for NO_MOVEMENT_AFTER_LABEL type", () => {
    const result = generateExceptionEmail({
      type: "NO_MOVEMENT_AFTER_LABEL",
      customerName: "John Doe",
      orderNumber: "1234",
    });

    expect(result.subject).toBe("We found a shipping issue with your order #1234");
    expect(result.body).toContain("Hi John Doe");
    expect(result.body).toContain("#1234");
    expect(result.body).toContain("tracking movement");
    expect(result.body).toContain("Best regards");
  });

  it("generates email for LONG_TRANSIT type", () => {
    const result = generateExceptionEmail({
      type: "LONG_TRANSIT",
      customerName: "Jane",
      orderNumber: "5678",
    });

    expect(result.subject).toContain("5678");
    expect(result.body).toContain("in transit longer than expected");
  });

  it("generates email for DELIVERY_FAILURE type", () => {
    const result = generateExceptionEmail({
      type: "DELIVERY_FAILURE",
      customerName: "Bob",
      orderNumber: "9999",
    });

    expect(result.subject).toContain("action needed");
    expect(result.body).toContain("issue delivering your package");
  });

  it("generates email for PRODUCTION_DELAY type", () => {
    const result = generateExceptionEmail({
      type: "PRODUCTION_DELAY",
      customerName: "Alice",
      orderNumber: "1111",
    });

    expect(result.subject).toContain("Status update");
    expect(result.body).toContain("taking a little longer");
  });

  it("uses default message for unknown type", () => {
    const result = generateExceptionEmail({
      type: "UNKNOWN_TYPE",
      customerName: "Test",
      orderNumber: "0000",
    });

    expect(result.subject).toContain("Important update");
    expect(result.body).toContain("identified an issue");
  });

  it("uses fallback for null customer name", () => {
    const result = generateExceptionEmail({
      type: "LONG_TRANSIT",
      customerName: null,
      orderNumber: "1234",
    });

    expect(result.body).toContain("Hi Valued Customer");
  });

  it("uses fallback for null order number", () => {
    const result = generateExceptionEmail({
      type: "LONG_TRANSIT",
      customerName: "Test",
      orderNumber: null,
    });

    expect(result.subject).toContain("your recent order");
  });

  it("includes tracking section when tracking number provided", () => {
    const result = generateExceptionEmail({
      type: "LONG_TRANSIT",
      customerName: "Test",
      orderNumber: "1234",
      trackingNumber: "9400111899223456789012",
      carrier: "USPS",
    });

    expect(result.body).toContain("9400111899223456789012");
    expect(result.body).toContain("USPS");
  });

  it("excludes tracking section when no tracking number", () => {
    const result = generateExceptionEmail({
      type: "LONG_TRANSIT",
      customerName: "Test",
      orderNumber: "1234",
    });

    expect(result.body).not.toContain("<strong>Tracking:</strong>");
  });
});

describe("appendResponseButtons", () => {
  const sampleBody = `<body><div><p style="margin:0 0 4px;">Best regards,</p><p>Team</p></div></body></html>`;
  const responseUrl = "https://example.com/respond/abc123";

  it("inserts buttons before Best regards", () => {
    const result = appendResponseButtons(sampleBody, responseUrl);

    expect(result).toContain("How would you like us to resolve this?");
    expect(result).toContain(`${responseUrl}?option=reship`);
    expect(result).toContain(`${responseUrl}?option=refund`);
    expect(result).toContain(`${responseUrl}?option=contact`);

    // Buttons should appear before "Best regards"
    const buttonsIdx = result.indexOf("Reship My Order");
    const regardsIdx = result.indexOf("Best regards");
    expect(buttonsIdx).toBeLessThan(regardsIdx);
  });

  it("includes all three button labels", () => {
    const result = appendResponseButtons(sampleBody, responseUrl);

    expect(result).toContain("Reship My Order");
    expect(result).toContain("Request Refund");
    expect(result).toContain("Contact Support");
  });

  it("falls back to end insertion when no Best regards found", () => {
    const bodyWithout = `<body><div><p>Some content</p></div></body></html>`;
    const result = appendResponseButtons(bodyWithout, responseUrl);

    expect(result).toContain("Reship My Order");
    expect(result).toContain("</body>");
  });

  it("works with generateExceptionEmail output", () => {
    const email = generateExceptionEmail({
      type: "LONG_TRANSIT",
      customerName: "Test",
      orderNumber: "1234",
    });

    const result = appendResponseButtons(email.body, responseUrl);

    // Should have buttons before Best regards
    const buttonsIdx = result.indexOf("Reship My Order");
    const regardsIdx = result.indexOf("Best regards");
    expect(buttonsIdx).toBeGreaterThan(-1);
    expect(regardsIdx).toBeGreaterThan(-1);
    expect(buttonsIdx).toBeLessThan(regardsIdx);
  });
});
