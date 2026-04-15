import crypto from "node:crypto";

export function verifyChatwootSignature(params: {
  rawBody: string;
  timestamp?: string;
  signature?: string;
  secret: string;
  maxAgeSeconds?: number;
}): boolean {
  const {
    rawBody,
    timestamp,
    signature,
    secret,
    maxAgeSeconds = 300
  } = params;

  if (!timestamp || !signature) return false;

  const timestampInt = Number(timestamp);
  if (Number.isNaN(timestampInt)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampInt) > maxAgeSeconds) {
    return false;
  }

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}
