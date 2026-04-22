/** Normalize to digits-only for comparing Twilio handles vs stored E.164. */
export function digitsOnly(phone: string): string {
  return String(phone ?? "").replace(/\D/g, "");
}

export function handlesMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // NANP: compare last 10 if one side is 11 with leading 1
  const tail = (d: string) => (d.length === 11 && d.startsWith("1") ? d.slice(1) : d).slice(-10);
  return tail(da) === tail(db);
}
