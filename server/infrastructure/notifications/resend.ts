import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { HttpError } from "../../errors.js";

export interface ResendEvent {
  id: string;
  type: string;
  emailId: string;
  deliveryId: string;
  createdAt: string;
}

// Resend uses the Svix HMAC-SHA256 protocol over the exact, unparsed body.
// https://docs.svix.com/receiving/verifying-payloads/how-manual
export function verifyResendEvent(
  body: string,
  headers: IncomingHttpHeaders,
  secret: string,
): ResendEvent {
  if (!secret || !secret.startsWith("whsec_"))
    throw new HttpError(503, "Resend webhooks are not configured.");
  const id = header(headers, "svix-id"),
    timestamp = header(headers, "svix-timestamp");
  const signatures = header(headers, "svix-signature");
  if (
    !id ||
    id.length > 200 ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    signatures.length > 4096
  )
    throw new HttpError(401, "Invalid webhook signature or timestamp.");
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.length < 16) throw new HttpError(503, "Resend webhook secret is invalid.");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  const valid = signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    if (version !== "v1" || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const supplied = Buffer.from(value, "base64");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  if (!valid) throw new HttpError(401, "Invalid webhook signature or timestamp.");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid webhook JSON.");
  }
  const data = parsed?.data as Record<string, unknown> | undefined;
  if (
    !parsed ||
    !data ||
    typeof parsed.type !== "string" ||
    parsed.type.length > 100 ||
    typeof parsed.created_at !== "string" ||
    Number.isNaN(Date.parse(parsed.created_at))
  )
    throw new HttpError(400, "Invalid Resend event.");
  if (!parsed.type.startsWith("email."))
    return {
      id,
      type: parsed.type,
      emailId: "",
      deliveryId: "",
      createdAt: new Date(parsed.created_at).toISOString(),
    };
  if (typeof data.email_id !== "string" || !/^[a-f0-9-]{36}$/i.test(data.email_id))
    throw new HttpError(400, "Invalid Resend email identifier.");
  const tags = data.tags;
  const deliveryId = Array.isArray(tags)
    ? tags.find((tag) => tag?.name === "asa_delivery_id")?.value
    : tags && typeof tags === "object"
      ? (tags as Record<string, unknown>).asa_delivery_id
      : "";
  return {
    id,
    type: parsed.type,
    emailId: data.email_id,
    deliveryId:
      typeof deliveryId === "string" && /^[a-f0-9-]{36}$/i.test(deliveryId) ? deliveryId : "",
    createdAt: new Date(parsed.created_at).toISOString(),
  };
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return typeof value === "string" ? value : "";
}
