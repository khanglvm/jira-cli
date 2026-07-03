import fs from "node:fs/promises";

export function toInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function parseCsv(value) {
  if (value == null || value === "") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseCsv(item));
  }
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function readJsonArg({ value, file, stdin = false, fallback = {} } = {}) {
  let raw = value;
  if (file) {
    raw = await fs.readFile(file, "utf8");
  } else if (stdin) {
    raw = await new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  }
  if (raw == null || String(raw).trim() === "") {
    return fallback;
  }
  return JSON.parse(String(raw));
}

export function sanitizeFileToken(value) {
  return String(value || "result")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "result";
}

export function compactValue(value, maxString = 220) {
  if (typeof value === "string") {
    return value.length > maxString ? `${value.slice(0, maxString)}...` : value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => compactValue(item, maxString));
  }
  const out = {};
  for (const key of Object.keys(value).slice(0, 16)) {
    out[key] = compactValue(value[key], maxString);
  }
  return out;
}

export function isMutatingTool(name) {
  return new Set([
    "jira_create_issue",
    "jira_update_issue",
    "jira_delete_issue",
    "jira_add_comment",
    "jira_transition_issue",
  ]).has(name);
}

export function redactSecret(secret) {
  if (!secret) {
    return secret;
  }
  const value = String(secret);
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
