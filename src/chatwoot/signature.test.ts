import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyChatwootSignature } from "./signature.js";

function sign(body: string, ts: string, secret: string): string {
  return `sha256=${crypto
    .createHmac("sha256", secret)
    .update(`${ts}.${body}`)
    .digest("hex")}`;
}

describe("verifyChatwootSignature", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ hello: "world" });

  it("returns true for a valid signature within TTL", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = sign(body, ts, secret);
    expect(
      verifyChatwootSignature({ rawBody: body, timestamp: ts, signature, secret })
    ).toBe(true);
  });

  it("returns false when signature is tampered", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = sign(body + "tamper", ts, secret);
    expect(
      verifyChatwootSignature({ rawBody: body, timestamp: ts, signature, secret })
    ).toBe(false);
  });

  it("returns false when timestamp is stale", () => {
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const signature = sign(body, ts, secret);
    expect(
      verifyChatwootSignature({ rawBody: body, timestamp: ts, signature, secret })
    ).toBe(false);
  });

  it("returns false when headers are missing", () => {
    expect(
      verifyChatwootSignature({ rawBody: body, secret })
    ).toBe(false);
  });
});
