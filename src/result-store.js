import fs from "node:fs/promises";
import path from "node:path";
import { defaultTmpDir } from "./config-store.js";
import { sanitizeFileToken } from "./utils.js";

export class ResultStore {
  constructor(options = {}) {
    this.tmpDir = options.tmpDir || defaultTmpDir();
    this.mode = options.mode || "auto";
    this.inlineMaxBytes = Number(options.inlineMaxBytes || 12000);
    this.pretty = !!options.pretty;
  }

  async emit(value, opts = {}) {
    const pretty = opts.pretty ?? this.pretty;
    const serialized = JSON.stringify(value, null, pretty ? 2 : 0);
    const bytes = Buffer.byteLength(serialized);
    const mode = opts.mode || this.mode;
    const shouldStore = mode === "file" || (mode === "auto" && bytes > this.inlineMaxBytes);
    if (!shouldStore) {
      process.stdout.write(`${serialized}\n`);
      return { stored: false, bytes };
    }
    const file = await this.write(value, { label: opts.label, ext: opts.ext, pretty });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stored: true,
      file,
      bytes,
      hint: `Inspect with jq '.' ${JSON.stringify(file)} | head`,
    }, null, pretty ? 2 : 0)}\n`);
    return { stored: true, file, bytes };
  }

  async write(value, opts = {}) {
    await fs.mkdir(this.tmpDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const label = sanitizeFileToken(opts.label || "result");
    const file = path.join(this.tmpDir, `${ts}-${label}.${opts.ext || "json"}`);
    await fs.writeFile(file, `${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`, "utf8");
    return file;
  }

  async list() {
    await fs.mkdir(this.tmpDir, { recursive: true });
    const entries = await fs.readdir(this.tmpDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = path.join(this.tmpDir, entry.name);
      const stat = await fs.stat(file);
      files.push({ name: entry.name, file, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
    return files.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  }

  async read(filePath) {
    const full = this.resolve(filePath);
    return { file: full, content: await fs.readFile(full, "utf8") };
  }

  async gc(maxAgeHours = 24) {
    const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
    const files = await this.list();
    const removed = [];
    for (const item of files) {
      if (Date.parse(item.modifiedAt) <= cutoff) {
        await fs.rm(item.file, { force: true });
        removed.push(item.file);
      }
    }
    return { removed, removedCount: removed.length, keptCount: files.length - removed.length };
  }

  resolve(filePath) {
    const root = path.resolve(this.tmpDir);
    const target = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
    const relative = path.relative(root, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to access path outside tmp dir: ${target}`);
    }
    return target;
  }
}
