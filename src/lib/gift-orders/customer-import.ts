export type GiftImportAddress = {
  first_name?: string;
  last_name?: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  province_code: string;
  zip: string;
  country_code: string;
  phone?: string;
};

export type GiftImportCustomer = {
  customerExternalId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress: GiftImportAddress;
};

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function parseDelimitedRecords(input: string, delimiter: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  const pushRecord = () => {
    record.push(value.trim());
    if (record.some((field) => field.length > 0)) records.push(record);
    record = [];
    value = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      record.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      pushRecord();
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (value.length > 0 || record.length > 0) pushRecord();
  return records;
}

function valueFromJson(
  source: Record<string, unknown>,
  keys: string[]
): string {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function parseJsonCustomers(input: string): GiftImportCustomer[] {
  const parsed: unknown = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new Error("JSON must be an array");

  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Every JSON customer must be an object");
    }
    const customer = entry as Record<string, unknown>;
    const addressValue =
      customer.shippingAddress || customer.shipping_address || {};
    const address =
      addressValue && typeof addressValue === "object"
        ? (addressValue as Record<string, unknown>)
        : {};
    const firstName =
      valueFromJson(address, ["first_name"]) ||
      valueFromJson(customer, ["first_name", "First Name"]);
    const lastName =
      valueFromJson(address, ["last_name"]) ||
      valueFromJson(customer, ["last_name", "Last Name"]);
    const phone =
      valueFromJson(address, ["phone"]) ||
      valueFromJson(customer, [
        "customerPhone",
        "customer_phone",
        "Default Address Phone",
        "phone",
        "Phone",
      ]);

    return {
      customerExternalId:
        valueFromJson(customer, [
          "customerExternalId",
          "customer_external_id",
          "customer_id",
          "Customer ID",
        ]) || undefined,
      customerName:
        valueFromJson(customer, [
          "customerName",
          "customer_name",
          "name",
        ]) || undefined,
      customerEmail:
        valueFromJson(customer, [
          "customerEmail",
          "customer_email",
          "email",
          "Email",
        ]) || undefined,
      customerPhone: phone || undefined,
      shippingAddress: {
        first_name: firstName,
        last_name: lastName,
        company:
          valueFromJson(address, ["company"]) ||
          valueFromJson(customer, [
            "company",
            "Default Address Company",
          ]),
        address1:
          valueFromJson(address, ["address1"]) ||
          valueFromJson(customer, [
            "address1",
            "Default Address Address1",
          ]),
        address2:
          valueFromJson(address, ["address2"]) ||
          valueFromJson(customer, [
            "address2",
            "Default Address Address2",
          ]),
        city:
          valueFromJson(address, ["city"]) ||
          valueFromJson(customer, ["city", "Default Address City"]),
        province_code:
          valueFromJson(address, ["province_code", "state"]) ||
          valueFromJson(customer, [
            "province_code",
            "state",
            "Default Address Province Code",
          ]),
        zip:
          valueFromJson(address, ["zip", "postal_code"]) ||
          valueFromJson(customer, [
            "zip",
            "postal_code",
            "Default Address Zip",
          ]),
        country_code: (
          valueFromJson(address, ["country_code", "country"]) ||
          valueFromJson(customer, [
            "country_code",
            "country",
            "Default Address Country Code",
          ]) ||
          "US"
        ).toUpperCase(),
        phone,
      },
    };
  });
}

function parseCsvCustomers(input: string): GiftImportCustomer[] {
  const firstLine = input.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const records = parseDelimitedRecords(input, delimiter);
  if (records.length < 2) {
    throw new Error("CSV needs a header and at least one customer row");
  }

  const headers = records[0].map(normalizeHeader);
  const find = (row: string[], aliases: string[]) => {
    for (const alias of aliases) {
      const index = headers.indexOf(alias);
      const value = index >= 0 ? row[index]?.trim() : "";
      if (value) return value;
    }
    return "";
  };

  return records.slice(1).map((row) => {
    const phone = find(row, [
      "default_address_phone",
      "customer_phone",
      "phone",
    ]);
    return {
      customerExternalId:
        find(row, ["customer_id", "external_id", "id"]) || undefined,
      customerName: find(row, ["customer_name", "name"]) || undefined,
      customerEmail:
        find(row, ["customer_email", "email"]) || undefined,
      customerPhone: phone || undefined,
      shippingAddress: {
        first_name: find(row, ["first_name", "firstname"]),
        last_name: find(row, ["last_name", "lastname"]),
        company: find(row, [
          "default_address_company",
          "company",
          "business_name",
        ]),
        address1: find(row, [
          "default_address_address1",
          "default_address_address_1",
          "address1",
          "address",
          "address_1",
        ]),
        address2: find(row, [
          "default_address_address2",
          "default_address_address_2",
          "address2",
          "address_2",
        ]),
        city: find(row, ["default_address_city", "city"]),
        province_code: find(row, [
          "default_address_province_code",
          "default_address_province",
          "province_code",
          "state",
          "state_code",
          "province",
        ]),
        zip: find(row, [
          "default_address_zip",
          "zip",
          "postal_code",
          "zipcode",
        ]),
        country_code: (
          find(row, [
            "default_address_country_code",
            "country_code",
            "country",
          ]) || "US"
        ).toUpperCase(),
        phone,
      },
    };
  });
}

export function parseGiftCustomers(raw: string): GiftImportCustomer[] {
  const input = raw.trim();
  if (!input) throw new Error("Select a CSV file or paste customer data first");
  return input.startsWith("[")
    ? parseJsonCustomers(input)
    : parseCsvCustomers(input);
}

export function missingGiftCustomerFields(customer: GiftImportCustomer) {
  const address = customer.shippingAddress;
  const name =
    customer.customerName ||
    `${address.first_name || ""} ${address.last_name || ""}`.trim();
  const missing: string[] = [];

  if (!name) missing.push("name");
  if (!address.address1) missing.push("address1");
  if (!address.city) missing.push("city");
  if (!address.province_code) missing.push("state");
  if (!address.zip) missing.push("zip");
  if (!address.country_code) missing.push("country");
  return missing;
}
