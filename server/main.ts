import { BRAND_CONFIG } from "../shared/config.js";
import { createApp } from "./routes/http.js";
process.umask(0o077);
const port = Number(process.env.ASA_BOLT_PORT ?? 8787);
const host = process.env.ASA_BOLT_HOST ?? "127.0.0.1";
if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
  throw new Error("Choose a valid API port.");
const app = createApp();
app.listen(port, host, () => console.info(`${BRAND_CONFIG.name} listening on ${host}:${port}`));
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    app.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 15000).unref();
  });
