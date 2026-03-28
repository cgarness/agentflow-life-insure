/**
 * Phone number formatting utilities.
 * Stored format: E.164 (+1XXXXXXXXXX)
 * Display format: (123)123-1234
 */

/**
 * Normalizes a phone number to E.164 format.
 * Strips all non-digits and ensures +1 prefix for 10-digit US numbers.
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");
  
  // If it's already E.164 (starts with 1 and is 11 digits), just add the +
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `+${cleaned}`;
  }
  
  // If it's a 10-digit US number, add +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // If it's already got a + and digits, just return it
  if (phone.startsWith("+") && cleaned.length > 0) {
    return `+${cleaned}`;
  }

  // Fallback: just return the digits
  return cleaned ? (cleaned.startsWith("+") ? cleaned : `+${cleaned}`) : "";
}

/**
 * Formats a phone number for display as (123)123-1234.
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone) return "";
  
  const cleaned = phone.replace(/\D/g, "");
  
  // Strip the +1 or 1 prefix if present for local formatting
  let digits = cleaned;
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    digits = cleaned.slice(1);
  }
  
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  
  // Fallback for non-standard lengths
  return phone;
}

/**
 * Formats a partial phone number as the user types.
 */
export function formatAsYouType(value: string): string {
  const digits = value.replace(/\D/g, "");
  
  // Handle leading 1
  let displayDigits = digits;
  if (digits.length > 10 && digits.startsWith("1")) {
    displayDigits = digits.slice(1, 11);
  } else if (digits.length > 10) {
    displayDigits = digits.slice(0, 10);
  }

  if (displayDigits.length <= 3) {
    return displayDigits.length > 0 ? `(${displayDigits}` : "";
  }
  if (displayDigits.length <= 6) {
    return `(${displayDigits.slice(0, 3)})${displayDigits.slice(3)}`;
  }
  return `(${displayDigits.slice(0, 3)})${displayDigits.slice(3, 6)}-${displayDigits.slice(6)}`;
}
