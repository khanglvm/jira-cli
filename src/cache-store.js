import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeFileToken } from "./utils.js";

export class CacheStore {
  constructor({ dir, ttlDays = 30, namespace = "default" } = {}) {
    this.dir = dir;
    this.ttlMs = Number(ttlDays || 30) * 24 * 60 * 60 * 1000;
    this.namespace = sanitizeFileToken(namespace);
  }

  fileFor(key) {
    return path.join(this.dir, "cache", this.namespace, `${sanitizeFileToken(key)}.json`);
  }

  async get(key, { refresh = false } = {}) {
    if (refresh || !this.dir) return null;
    const file = this.fileFor(key);
    try {
      const raw = await fs.readFile(file, "utf8");
      const cached = JSON.parse(raw);
      if (!cached || typeof cached !== "object" || !cached.cachedAt) return null;
      if (Date.now() - Date.parse(cached.cachedAt) > this.ttlMs) return null;
      return { ...cached.value, cache: { hit: true, key, file, cachedAt: cached.cachedAt, expiresAt: new Date(Date.parse(cached.cachedAt) + this.ttlMs).toISOString() } };
    } catch (err) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  async set(key, value) {
    if (!this.dir) return value;
    const file = this.fileFor(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const cachedAt = new Date().toISOString();
    await fs.writeFile(file, `${JSON.stringify({ cachedAt, value }, null, 2)}\n`, "utf8");
    return { ...value, cache: { hit: false, key, file, cachedAt, expiresAt: new Date(Date.parse(cachedAt) + this.ttlMs).toISOString() } };
  }
}
