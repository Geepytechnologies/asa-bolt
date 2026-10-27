import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, chmod, open, readdir, unlink, link } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";

export async function snapshotDatabase(source: string, destination: string): Promise<string> {
  if (resolve(source) === resolve(destination))
    throw new Error("The snapshot must use a different path.");
  const reserved = await open(destination, "wx", 0o600);
  await reserved.close();
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(source, { readOnly: true });
    await backup(db, destination);
    const snapshot = new DatabaseSync(destination, { readOnly: true });
    try {
      if (snapshot.prepare("PRAGMA quick_check").get()?.quick_check !== "ok")
        throw new Error("Snapshot integrity check failed.");
      if (snapshot.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Snapshot foreign key check failed.");
    } finally {
      snapshot.close();
    }
    await chmod(destination, 0o600);
    return resolve(destination);
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  } finally {
    db?.close();
  }
}

export async function createBackup(source: string, directory: string, keep = 28): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `asa-ride-${new Date().toISOString().replaceAll(":", "-")}.sqlite`;
  const path = resolve(directory, filename);
  const pending = `${path}.partial-${randomUUID()}`;
  try {
    await snapshotDatabase(source, pending);
    // Publish only verified snapshots, atomically, without overwriting an existing backup.
    await link(pending, path);
  } finally {
    await unlink(pending).catch(() => undefined);
  }
  const files = (await readdir(directory))
    .filter((name) => /^asa-ride-\d{4}-\d{2}-\d{2}T[\d.-]+Z\.sqlite$/.test(name))
    .sort()
    .reverse();
  for (const file of files.slice(keep))
    if (basename(file) === file) await unlink(join(directory, file));
  return path;
}
