/** Parse JSON body from FunctionsHttpError.context (non-2xx Edge responses). */
export async function readEdgeFunctionErrorBody(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: Response })?.context;
  if (!ctx || typeof ctx.clone !== "function") return null;
  try {
    const j = (await ctx.clone().json()) as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof j.error === "string") parts.push(j.error);
    if (typeof j.detail === "string") parts.push(j.detail);
    if (typeof j.message === "string") parts.push(j.message);
    if (typeof j.step === "string") parts.push(`[${j.step}]`);
    if (j.code != null) parts.push(String(j.code));
    return parts.length ? parts.join(" — ") : null;
  } catch {
    return null;
  }
}

export async function edgeFunctionErrorMessage(
  error: unknown,
  fallback = "Request failed",
): Promise<string> {
  const body = await readEdgeFunctionErrorBody(error);
  if (body) return body;
  if (error instanceof Error && error.message && !error.message.includes("non-2xx")) {
    return error.message;
  }
  return fallback;
}
