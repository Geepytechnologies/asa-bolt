import { BRAND_CONFIG } from "../shared/config.js";
import { createApp } from "./routes/http.js";

const port = Number(process.env.ASA_BOLT_PORT ?? 8787);
const app = createApp();

app.listen(port, "127.0.0.1", () => {
  console.info(`${BRAND_CONFIG.name} API listening on http://127.0.0.1:${port}`);
});
