import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { createBackup, snapshotDatabase } from "../server/backup.js";

process.umask(0o077);
const [action, sourceArg, destinationArg] = process.argv.slice(2);
const source = sourceArg ?? process.env.ASA_BOLT_DATABASE_PATH ?? "./data/asa-bolt.sqlite";
try {
  if (action === "restore") {
    if (!sourceArg || !destinationArg)
      throw new Error(
        "Use db:restore -- BACKUP_PATH NEW_DATABASE_PATH. Existing files are never replaced.",
      );
    await mkdir(dirname(resolve(destinationArg)), { recursive: true, mode: 0o700 });
    console.info(`Restored verified copy: ${await snapshotDatabase(sourceArg, destinationArg)}`);
  } else if (action === "backup") {
    console.info(
      `Verified backup: ${await createBackup(source, destinationArg ?? process.env.ASA_BOLT_BACKUP_DIR ?? "./backups")}`,
    );
  } else throw new Error("Choose backup or restore.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database operation failed.");
  process.exitCode = 1;
}
