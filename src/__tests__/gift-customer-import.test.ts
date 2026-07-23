import { describe, expect, it } from "vitest";
import {
  missingGiftCustomerFields,
  parseGiftCustomers,
} from "@/lib/gift-orders/customer-import";

describe("parseGiftCustomers", () => {
  it("maps Shopify Customer Export headers", () => {
    const csv = [
      "Customer ID,First Name,Last Name,Email,Default Address Company,Default Address Address1,Default Address Address2,Default Address City,Default Address Province Code,Default Address Country Code,Default Address Zip,Default Address Phone,Phone",
      '1001,Jane,Doe,jane@example.com,"Acme, Inc",123 Main St,Apt 4,Los Angeles,CA,US,90001,,5551234567',
    ].join("\n");

    const customers = parseGiftCustomers(csv);

    expect(customers).toEqual([
      {
        customerExternalId: "1001",
        customerName: undefined,
        customerEmail: "jane@example.com",
        customerPhone: "5551234567",
        shippingAddress: {
          first_name: "Jane",
          last_name: "Doe",
          company: "Acme, Inc",
          address1: "123 Main St",
          address2: "Apt 4",
          city: "Los Angeles",
          province_code: "CA",
          country_code: "US",
          zip: "90001",
          phone: "5551234567",
        },
      },
    ]);
    expect(missingGiftCustomerFields(customers[0])).toEqual([]);
  });

  it("prefers the default-address phone and supports quoted line breaks", () => {
    const csv =
      'Customer ID,First Name,Last Name,Default Address Address1,Default Address City,Default Address Province Code,Default Address Zip,Default Address Phone,Phone,Note\n' +
      '1002,John,Smith,456 Oak Ave,Dallas,TX,75001,5550001111,5559992222,"Line one\nLine two"';

    const [customer] = parseGiftCustomers(csv);

    expect(customer.customerPhone).toBe("5550001111");
    expect(customer.shippingAddress.phone).toBe("5550001111");
    expect(customer.shippingAddress.address1).toBe("456 Oak Ave");
  });

  it("continues to support simple CSV aliases", () => {
    const csv = [
      "customer_id,name,email,address1,city,state,zip,country_code",
      "C-1,Jane Doe,jane@example.com,123 Main St,Los Angeles,CA,90001,us",
    ].join("\n");

    const [customer] = parseGiftCustomers(csv);

    expect(customer.customerName).toBe("Jane Doe");
    expect(customer.shippingAddress.country_code).toBe("US");
    expect(missingGiftCustomerFields(customer)).toEqual([]);
  });

  it("reports required address fields that are missing", () => {
    const [customer] = parseGiftCustomers(
      "first_name,last_name,address1,city,state,zip\nJane,Doe,,,,"
    );

    expect(missingGiftCustomerFields(customer)).toEqual([
      "address1",
      "city",
      "state",
      "zip",
    ]);
  });
});
