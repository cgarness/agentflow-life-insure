/** Resend uses the Svix v1 signed envelope. Verify the raw body before trusting event tags. */
export async function verifiedResendEvent(
  raw: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const id = headers.get("svix-id");
  const stamp = headers.get("svix-timestamp");
  if (
    !secret.startsWith("whsec_") || !id || !stamp || !/^\d+$/.test(stamp) ||
    Math.abs(Math.floor(now / 1000) - Number(stamp)) > 300
  ) return null;
  try {
    const bytes = Uint8Array.from(atob(secret.slice(6)), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const payload = new TextEncoder().encode(`${id}.${stamp}.${raw}`);
    for (const token of (headers.get("svix-signature") ?? "").split(/\s+/)) {
      if (!token.startsWith("v1,")) continue;
      const signature = Uint8Array.from(atob(token.slice(3)), (char) => char.charCodeAt(0));
      if (await crypto.subtle.verify("HMAC", key, signature, payload)) {
        const event: unknown = JSON.parse(raw);
        return event && typeof event === "object" ? event as Record<string, unknown> : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}
