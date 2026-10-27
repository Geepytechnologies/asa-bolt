import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Database } from "./infrastructure/database.js";
import { HttpError } from "./errors.js";

export function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  // Trust exactly one reverse proxy only when direct access to this port is blocked.
  const forwarded = request.headers["x-forwarded-for"];
  if (trustProxy && typeof forwarded === "string") {
    const address = forwarded.split(",").at(-1)?.trim() ?? "";
    if (isIP(address)) return address;
  }
  return request.socket.remoteAddress ?? "unknown";
}

export class ApiLimits {
  constructor(private readonly database: Database) {}
  check(request: IncomingMessage, pathname: string, ip: string): void {
    if (pathname === "/api/health") return;
    this.consume(`api:${ip}`, 600, 60_000);
    if (request.method === "POST" && pathname === "/api/owner/login")
      this.consume(`login:${ip}`, 10, 15 * 60_000);
    if (request.method === "POST" && pathname === "/api/location-requests")
      this.consume(`location:${ip}`, 10, 15 * 60_000);
    if (
      request.method === "POST" &&
      /^\/api\/bookings\/status\/[^/]+\/(cancel|whatsapp)$/.test(pathname)
    )
      this.consume(`private-mutation:${ip}`, 20, 15 * 60_000);
  }
  private consume(key: string, max: number, duration: number): void {
    const now = Date.now(),
      hash = createHash("sha256").update(key).digest("hex");
    const db = this.database.connection;
    const row = db
      .prepare(
        "INSERT INTO history_rate_limits (key_hash, attempts, resets_at) VALUES (?, 1, ?) ON CONFLICT(key_hash) DO UPDATE SET attempts = CASE WHEN resets_at <= ? THEN 1 ELSE attempts + 1 END, resets_at = CASE WHEN resets_at <= ? THEN excluded.resets_at ELSE resets_at END RETURNING attempts",
      )
      .get(hash, now + duration, now, now);
    if (Number(row?.attempts) > max)
      throw new HttpError(429, "Too many attempts. Please wait before trying again.");
  }
}

export function secureHeaders(response: ServerResponse, production: boolean): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cache-Control", "no-store");
  if (production) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
}

const contentTypes: Record<string, string> = {
  ".webmanifest": "application/manifest+json",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
export async function serveFrontend(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  directory: string,
): Promise<void> {
  if (!directory || !["GET", "HEAD"].includes(request.method ?? ""))
    throw new HttpError(404, "Page not found.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "Invalid page path.");
  }
  if (
    decoded.includes("\0") ||
    decoded.split("/").some((part) => part.startsWith(".") || part.includes("\\"))
  )
    throw new HttpError(404, "Page not found.");
  const root = resolve(directory),
    asset = Boolean(extname(decoded));
  const path = resolve(root, asset ? `.${decoded}` : "index.html");
  if (!path.startsWith(root + sep)) throw new HttpError(404, "Page not found.");
  const type = contentTypes[extname(path)];
  if (!type) throw new HttpError(404, "Asset not found.");
  let body: Buffer;
  try {
    body = await readFile(path);
  } catch {
    throw new HttpError(404, "Page or asset not found. Prepare the frontend before release.");
  }
  if (asset && /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(decoded))
    response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  response.writeHead(200, { "Content-Type": type });
  response.end(request.method === "HEAD" ? undefined : body);
}
