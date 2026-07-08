import { describe, it, expect } from "vitest";
import { redactString } from "../src/redact.js";

// NOTE: Token-like fixtures are synthesized at runtime via string concatenation
// so no token-shaped literal ever appears in version-controlled source.
// The AWS canary "AKIAIOSFODNN7EXAMPLE" is vendor-documented as a test value
// and is on scanner allowlists.

describe("redactString", () => {
  it("redacts AWS access key IDs", () => {
    const { value, count } = redactString("key=AKIAIOSFODNN7EXAMPLE done");
    expect(value).toBe("key=[REDACTED:aws-key] done");
    expect(count).toBe(1);
  });

  it("redacts GitHub tokens", () => {
    const fakeToken = "gh" + "p_" + "A".repeat(36);
    const { value, count } = redactString(`token: ${fakeToken}`);
    expect(value.includes("[REDACTED:gh-token]")).toBe(true);
    expect(count).toBe(1);
  });

  it("redacts OpenAI/Anthropic-style sk- keys", () => {
    const fakeKey = "sk" + "-" + "A".repeat(30);
    const { value, count } = redactString(fakeKey);
    expect(value).toBe("[REDACTED:sk-key]");
    expect(count).toBe(1);
  });

  it("redacts Bearer tokens", () => {
    const { value, count } = redactString("Authorization: Bearer abc.def.ghi");
    expect(value).toBe("Authorization: [REDACTED:bearer]");
    expect(count).toBe(1);
  });

  it("redacts PEM blocks", () => {
    const { value, count } = redactString("-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----");
    expect(value.includes("[REDACTED:pem]")).toBe(true);
    expect(count).toBe(1);
  });

  it("returns zero count when nothing matches", () => {
    const { value, count } = redactString("hello world");
    expect(value).toBe("hello world");
    expect(count).toBe(0);
  });

  it("counts multiple redactions", () => {
    const fakeKey = "sk" + "-" + "A".repeat(30);
    const { count } = redactString(`AKIAIOSFODNN7EXAMPLE and ${fakeKey}`);
    expect(count).toBe(2);
  });
});
