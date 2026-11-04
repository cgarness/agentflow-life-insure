import {
  type Credentials,
  hasControlCharacters,
  type InventoryNumber,
  isNumberOfType,
  NumberError,
  type NumberType,
  object,
  readJson,
  type SearchInput,
} from "./contracts.ts";

export async function providerRead(
  url: string,
  creds: Credentials,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${
          btoa(`${creds.accountSid}:${creds.authToken}`)
        }`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Provider read rejected");
    }
    const data = object(await readJson(response, 262_144));
    if (!data) throw new Error("Provider object missing");
    return data;
  } catch {
    throw new NumberError(
      "PROVIDER_UNAVAILABLE",
      "Twilio could not verify number availability. Please try again.",
      502,
    );
  }
}

function label(value: unknown, limit = 100): string | null {
  return typeof value === "string" && value.trim() &&
      !hasControlCharacters(value)
    ? value.trim().slice(0, limit)
    : null;
}
function inventoryRows(
  data: Record<string, unknown>,
  type: NumberType,
): InventoryNumber[] {
  if (!Array.isArray(data.available_phone_numbers)) {
    throw new NumberError(
      "PROVIDER_UNAVAILABLE",
      "Twilio returned invalid number inventory.",
      502,
    );
  }
  const result: InventoryNumber[] = [];
  for (const value of data.available_phone_numbers) {
    const row = object(value);
    if (
      !row || !isNumberOfType(row.phone_number, type) ||
      row.iso_country !== "US" || object(row.capabilities)?.voice !== true
    ) continue;
    result.push({
      phone_number: row.phone_number,
      friendly_name: label(row.friendly_name, 64),
      locality: type === "local" ? label(row.locality) : null,
      region: type === "local" ? label(row.region, 2) : null,
      postal_code: type === "local" ? label(row.postal_code, 16) : null,
      country: "US",
      number_type: type,
    });
  }
  return result;
}
function inventoryUrl(
  creds: Credentials,
  type: NumberType,
  params: URLSearchParams,
): string {
  const collection = type === "local" ? "Local" : "TollFree";
  return `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/AvailablePhoneNumbers/US/${collection}.json?${params}`;
}

export async function searchInventory(
  creds: Credentials,
  input: SearchInput,
  fetchImpl: typeof fetch,
): Promise<InventoryNumber[]> {
  if (input.number_type === "local") {
    const params = new URLSearchParams({ PageSize: String(input.limit) });
    if (input.area_code) params.set("AreaCode", input.area_code);
    if (input.locality) params.set("InLocality", input.locality);
    if (input.state) params.set("InRegion", input.state);
    return inventoryRows(
      await providerRead(
        inventoryUrl(creds, "local", params),
        creds,
        fetchImpl,
      ),
      "local",
    ).slice(0, input.limit);
  }
  const prefixes = input.prefix === "prefer_800"
    ? ["800", "888"]
    : [input.prefix];
  const lists = await Promise.all(prefixes.map(async (prefix) => {
    const params = new URLSearchParams({
      PageSize: String(input.limit),
      AreaCode: prefix,
      VoiceEnabled: "true",
    });
    const rows = inventoryRows(
      await providerRead(
        inventoryUrl(creds, "toll_free", params),
        creds,
        fetchImpl,
      ),
      "toll_free",
    );
    return rows.filter((row) => row.phone_number.slice(2, 5) === prefix);
  }));
  const seen = new Set<string>();
  return lists.flat().filter((row) => {
    if (seen.has(row.phone_number)) return false;
    seen.add(row.phone_number);
    return true;
  }).slice(0, input.limit);
}

export async function exactInventory(
  creds: Credentials,
  phone: string,
  type: NumberType,
  fetchImpl: typeof fetch,
): Promise<InventoryNumber> {
  const params = new URLSearchParams({ Contains: phone, PageSize: "20" });
  if (type === "toll_free") params.set("VoiceEnabled", "true");
  const rows = inventoryRows(
    await providerRead(inventoryUrl(creds, type, params), creds, fetchImpl),
    type,
  );
  const row = rows.find((item) => item.phone_number === phone);
  if (!row) {
    throw new NumberError(
      "NUMBER_UNAVAILABLE",
      "This number is no longer available. Search again.",
      409,
    );
  }
  return row;
}

export async function providerOwnsNumber(
  creds: Credentials,
  phone: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const params = new URLSearchParams({ PhoneNumber: phone, PageSize: "20" });
  const data = await providerRead(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?${params}`,
    creds,
    fetchImpl,
  );
  if (!Array.isArray(data.incoming_phone_numbers)) {
    throw new NumberError(
      "PROVIDER_UNAVAILABLE",
      "Twilio number ownership could not be verified.",
      502,
    );
  }
  return data.incoming_phone_numbers.some((value) =>
    object(value)?.phone_number === phone
  );
}

export function friendlyName(number: InventoryNumber): string {
  return ([number.locality, number.region].filter(Boolean).join(", ") ||
    number.friendly_name || number.phone_number).slice(0, 64);
}
