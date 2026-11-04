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

export async function readTextArg({ value, file, stdin = false, fallback = "" } = {}) {
  if (file) {
    return fs.readFile(file, "utf8");
  }
  if (stdin) {
    return new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  }
  if (value == null) {
    return fallback;
  }
  return String(value);
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
    "jira_assign_issue",
    "jira_update_labels",
    "jira_delete_issue",
    "jira_add_comment",
    "jira_update_comment",
    "jira_delete_comment",
    "jira_add_attachment",
    "jira_comment_with_attachments",
    "jira_transition_issue",
    "jira_transition_issue_by_name",
    "jira_add_vote",
    "jira_remove_vote",
    "jira_add_watcher",
    "jira_remove_watcher",
    "jira_add_worklog",
    "jira_update_worklog",
    "jira_delete_worklog",
    "jira_link_issues",
    "jira_delete_issue_link",
    "jira_upsert_remote_link",
    "jira_update_remote_link",
    "jira_delete_remote_link",
    "jira_move_issues_to_sprint",
    "jira_move_issues_to_backlog",
    "jira_request",
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

// Split a trailing ORDER BY clause off a JQL string. Quoted strings are skipped
// so a literal like "ORDER BY" inside a value is not treated as a clause.
export function splitJqlOrderBy(jql) {
  const text = String(jql ?? "");
  let quote = null;
  let found = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/^order\s+by\b/i.test(text.slice(i)) && (i === 0 || /[\s)]/.test(text[i - 1]))) {
      found = i;
      break;
    }
  }
  if (found < 0) return { where: text.trim(), orderBy: "" };
  return {
    where: text.slice(0, found).trim(),
    orderBy: text.slice(found).replace(/^order\s+by\s*/i, "").trim(),
  };
}
