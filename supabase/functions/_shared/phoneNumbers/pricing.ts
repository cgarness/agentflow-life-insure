import {
  type Credentials,
  NumberError,
  type NumberType,
  object,
  type QuotePrice,
  type RentalPrice,
} from "./contracts.ts";
import { providerRead } from "./inventory.ts";

export function decimal(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/.test(value)
  ) {
    throw new NumberError(
      "PRICE_UNAVAILABLE",
      "Current pricing could not be verified. Please try again.",
      503,
    );
  }
  return value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
}
function currency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) {
    throw new NumberError(
      "PRICE_UNAVAILABLE",
      "The pricing currency could not be verified.",
      503,
    );
  }
  return value.toUpperCase();
}
export function quotePrice(value: unknown): QuotePrice {
  const data = object(value);
  if (!data) {
    throw new NumberError(
      "PRICE_UNAVAILABLE",
      "Current pricing could not be verified.",
      503,
    );
  }
  return {
    monthly_price: decimal(data.monthly_price),
    currency: currency(data.currency),
    inbound_per_minute: decimal(data.inbound_per_minute),
  };
}
export async function rentalPrice(
  creds: Credentials,
  type: NumberType,
  fetchImpl: typeof fetch,
): Promise<RentalPrice> {
  try {
    const data = await providerRead(
      "https://pricing.twilio.com/v1/PhoneNumbers/Countries/US",
      creds,
      fetchImpl,
    );
    if (data.iso_country !== "US" || !Array.isArray(data.phone_number_prices)) {
      throw new Error("Country pricing missing");
    }
    const label = type === "local" ? "local" : "toll free";
    const matches = data.phone_number_prices.map(object).filter((price) =>
      price?.number_type === label
    );
    if (matches.length !== 1) throw new Error("Number price is ambiguous");
    return {
      monthly_price: decimal(matches[0]?.current_price),
      currency: currency(data.price_unit),
    };
  } catch {
    throw new NumberError(
      "PRICE_UNAVAILABLE",
      "Current phone number rental pricing could not be verified.",
      503,
    );
  }
}
export async function currentPrice(
  creds: Credentials,
  phone: string,
  type: NumberType,
  fetchImpl: typeof fetch,
): Promise<QuotePrice> {
  try {
    const [rental, voice] = await Promise.all([
      rentalPrice(creds, type, fetchImpl),
      providerRead(
        `https://pricing.twilio.com/v2/Voice/Numbers/${
          encodeURIComponent(phone)
        }`,
        creds,
        fetchImpl,
      ),
    ]);
    if (
      voice.destination_number !== phone || voice.iso_country !== "US" ||
      currency(voice.price_unit) !== rental.currency
    ) {
      throw new Error("Selected-number pricing does not match");
    }
    const inbound = object(voice.inbound_call_price);
    if (voice.inbound_call_price != null && !inbound) {
      throw new Error("Malformed selected-number pricing");
    }
    // V2 may have no inbound rate for an unpurchased number. Only a wholly absent rate
    // permits the documented US type-specific current-price lookup, never a read error.
    const missing = !inbound ||
      ["base_price", "current_price", "number_type"].every((field) =>
        inbound[field] == null
      );
    if (missing) {
      const country = await providerRead(
        "https://pricing.twilio.com/v1/Voice/Countries/US",
        creds,
        fetchImpl,
      );
      if (
        country.iso_country !== "US" ||
        currency(country.price_unit) !== rental.currency ||
        !Array.isArray(country.inbound_call_prices)
      ) {
        throw new Error("Country inbound pricing does not match");
      }
      const matches = country.inbound_call_prices.map(object).filter((price) =>
        inboundType(price?.number_type, type)
      );
      if (matches.length !== 1) {
        throw new Error("Country inbound pricing is missing or ambiguous");
      }
      return {
        ...rental,
        inbound_per_minute: decimal(matches[0]?.current_price),
      };
    }
    if (!inboundType(inbound.number_type, type)) {
      throw new Error("Selected-number type does not match");
    }
    return { ...rental, inbound_per_minute: decimal(inbound.current_price) };
  } catch {
    throw new NumberError(
      "PRICE_UNAVAILABLE",
      "Current rental and inbound usage pricing could not be verified.",
      503,
    );
  }
}
function inboundType(value: unknown, type: NumberType): boolean {
  return type === "local"
    ? value === "local"
    : value === "toll-free" || value === "toll free";
}
export function samePrice(left: QuotePrice, right: QuotePrice): boolean {
  return left.currency === right.currency &&
    decimal(left.monthly_price) === decimal(right.monthly_price) &&
    decimal(left.inbound_per_minute) === decimal(right.inbound_per_minute);
}
