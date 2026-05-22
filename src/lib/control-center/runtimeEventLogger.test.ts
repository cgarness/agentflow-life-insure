import { describe, it, expect } from "vitest";
import {
  sanitizeText,
  sanitizeObject,
  generateEventKeySignature,
  cyb53,
} from "./runtimeEventLogger";

describe("runtimeEventLogger - cyb53", () => {
  it("should generate a stable 36-base hash string", () => {
    const h1 = cyb53("hello world");
    const h2 = cyb53("hello world");
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("string");
    expect(h1.length).toBeGreaterThan(3);
  });
});

describe("runtimeEventLogger - generateEventKeySignature", () => {
  it("should generate the same key for stack traces differing only by digits, UUIDs, line/column numbers, and whitespace", () => {
    const uuid1 = "a0000000-0000-0000-0000-000000000001";
    const uuid2 = "f81d4fae-7dec-11d0-a765-00a0c91e6bf6";

    const stack1 = `
      Error: Database connection lost
        at query (http://localhost:5173/src/lib/db.ts:25:12)
        at runTask (http://localhost:5173/src/lib/tasks.ts:120:4)
        User ID: ${uuid1}
    `;

    const stack2 = `
      Error: Database connection lost
        at query (http://localhost:5173/src/lib/db.ts:32:85)
        at runTask (http://localhost:5173/src/lib/tasks.ts:124:19)
        User ID: ${uuid2}
    `;

    const key1 = generateEventKeySignature("Db Error", "lost connection", stack1);
    const key2 = generateEventKeySignature("Db Error", "lost connection", stack2);

    expect(key1).toBe(key2);
  });
});

describe("runtimeEventLogger - sanitizeText", () => {
  it("should redact JWTs, Bearer headers, cookies, passwords, and Twilio SIDs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const twilioSid = "AC" + "1234567890abcdef1234567890abcdef";
    const bearer = "Bearer someLongToken123456789";

    const inputText = `
      Failed request to api:
      Authorization: ${bearer}
      Cookie: session_id=cookie123;
      password=my-super-secret-pass
      JWT: ${jwt}
      Twilio: ${twilioSid}
      URL: https://supabase.co/functions/v1/email-webhook?token=my-secret-token-here&otherParam=123
    `;

    const sanitized = sanitizeText(inputText);

    expect(sanitized).not.toContain(jwt);
    expect(sanitized).not.toContain(twilioSid);
    expect(sanitized).not.toContain("my-super-secret-pass");
    expect(sanitized).not.toContain("my-secret-token-here");
    expect(sanitized).toContain("[REDACTED_JWT]");
    expect(sanitized).toContain("[REDACTED_TWILIO_SID]");
    expect(sanitized).toContain("Bearer [REDACTED]");
    expect(sanitized).toContain("Cookie: [REDACTED]");
    expect(sanitized).toContain("password: [REDACTED]");
    expect(sanitized).toContain("https://supabase.co/functions/v1/email-webhook?token=%5BREDACTED%5D&otherParam=%5BREDACTED%5D");
  });

  it("should sanitize query parameters from file paths with line markers in stack traces", () => {
    const stack = `
      Error: custom error
        at http://localhost:5173/src/App.tsx?auth=secretToken123&env=dev:45:12
    `;
    const sanitized = sanitizeText(stack);
    expect(sanitized).not.toContain("secretToken123");
    expect(sanitized).toContain("http://localhost:5173/src/App.tsx?auth=%5BREDACTED%5D&env=%5BREDACTED%5D:45:12");
  });
});

describe("runtimeEventLogger - sanitizeObject", () => {
  it("should redact sensitive fields recursively and keep safe system keys", () => {
    const metadata = {
      user: {
        id: "123",
        email: "test@example.com",
        password: "my-plain-text-pass",
      },
      connection: {
        jwt: "secretjwtinfo",
        apiKey: "someKeyHere",
        event_key: "safe_event_key_dont_redact_me",
        check_key: "safe_check_key",
      },
      message: "Regular message",
    };

    const sanitized = sanitizeObject(metadata);

    expect(sanitized.user.password).toBe("[REDACTED]");
    expect(sanitized.connection.jwt).toBe("[REDACTED]");
    expect(sanitized.connection.apiKey).toBe("[REDACTED]");
    expect(sanitized.connection.event_key).toBe("safe_event_key_dont_redact_me");
    expect(sanitized.connection.check_key).toBe("safe_check_key");
    expect(sanitized.user.email).toBe("test@example.com");
    expect(sanitized.message).toBe("Regular message");
  });
});
