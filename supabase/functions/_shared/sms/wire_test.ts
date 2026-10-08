import { signedHeaders, verifyRequest } from "./wire.ts";
const assert = {
  ok(value: unknown) { if (!value) throw new Error("Expected authenticated nonce"); },
  async rejects(run: () => Promise<unknown>) {
    let rejected = false;
    try { await run(); } catch { rejected = true; }
    if (!rejected) throw new Error("Expected authentication rejection");
  },
};
const secret = "synthetic-only-gateway-test-secret".repeat(2);
Deno.test("hosted gateway path preserves canonical signature and endpoint binding", async () => {
  const body = '{"action":"eligibility"}';
  for (const name of ["agentflow-consent", "sms-consent-events"]) {
    const canonical = `/functions/v1/${name}`;
    const headers = await signedHeaders(secret, canonical, body);
    for (const path of [canonical, `/${name}`]) {
      assert.ok(
        await verifyRequest(
          new Request(`https://example.test${path}`, {
            method: "POST",
            headers,
          }),
          body,
          secret,
          canonical,
        ),
      );
    }
    for (
      const path of [
        `/${name}/`,
        `/${name}/other`,
        `/${name}?x=1`,
        "/wrong-endpoint",
        "/functions/v1/wrong-endpoint",
      ]
    ) {
      await assert.rejects(() =>
        verifyRequest(
          new Request(`https://example.test${path}`, {
            method: "POST",
            headers,
          }),
          body,
          secret,
          canonical,
        )
      );
    }
    const noncanonicalHeaders = await signedHeaders(secret, `/${name}`, body);
    await assert.rejects(() =>
      verifyRequest(
        new Request(`https://example.test/${name}`, {
          method: "POST",
          headers: noncanonicalHeaders,
        }),
        body,
        secret,
        canonical,
      )
    );
  }
});
