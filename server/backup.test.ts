import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createBackup, snapshotDatabase } from "./backup.js";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("database recovery", () => {
  it("captures live WAL changes, verifies a private snapshot, and refuses an overwrite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "asa-backup-test-"));
    directories.push(dir);
    const source = join(dir, "live.sqlite"),
      writer = new DatabaseSync(source);
    writer.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES ('saved ride');",
    );
    try {
      const saved = await createBackup(source, join(dir, "backups"));
      expect((await stat(saved)).mode & 0o777).toBe(0o600);
      const restored = join(dir, "restored.sqlite");
      await snapshotDatabase(saved, restored);
      const reader = new DatabaseSync(restored, { readOnly: true });
      try {
        expect(reader.prepare("SELECT value FROM retained").get()?.value).toBe("saved ride");
        expect(reader.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
      } finally {
        reader.close();
      }
      await expect(snapshotDatabase(saved, restored)).rejects.toMatchObject({ code: "EEXIST" });
      await expect(snapshotDatabase(source, source)).rejects.toThrow("different path");
    } finally {
      writer.close();
    }
  });
});
