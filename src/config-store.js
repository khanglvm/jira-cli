import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";
import { parseCsv, redactSecret } from "./utils.js";

export const CONFIG_VERSION = 1;

export function defaultConfigPath() {
  if (process.env.JIRA_CLI_CONFIG) {
    return path.resolve(process.env.JIRA_CLI_CONFIG);
  }
  if (process.env.JIRA_AGENT_CONFIG) {
    return path.resolve(process.env.JIRA_AGENT_CONFIG);
  }
  return path.join(os.homedir(), ".config", "jira-cli", "config.json");
}

export function defaultTmpDir() {
  if (process.env.JIRA_CLI_TMP_DIR) {
    return path.resolve(process.env.JIRA_CLI_TMP_DIR);
  }
  if (process.env.JIRA_AGENT_TMP_DIR) {
    return path.resolve(process.env.JIRA_AGENT_TMP_DIR);
  }
  return path.join(os.homedir(), ".cache", "jira-cli", "tmp");
}

export function blankConfig() {
  return {
    version: CONFIG_VERSION,
    defaultProfile: null,
    profiles: {},
  };
}

export async function loadConfig(configPath = defaultConfigPath()) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return blankConfig();
    }
    if (!parsed.profiles || typeof parsed.profiles !== "object") {
      parsed.profiles = {};
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, "defaultProfile")) {
      parsed.defaultProfile = null;
    }
    parsed.version = parsed.version || CONFIG_VERSION;
    return parsed;
  } catch (err) {
    if (err?.code === "ENOENT") {
      return blankConfig();
    }
    throw new Error(`Failed to read config ${configPath}: ${err.message}`);
  }
}

export async function saveConfig(configPath, config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) {
    throw new Error("baseUrl is required");
  }
  const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseUrl must start with http:// or https://");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/rest\/api\/\d+\/?$/i, "");
  return parsed.toString().replace(/\/+$/, "");
}

export function buildProfile({
  id,
  name,
  description,
  keywords,
  baseUrl,
  username,
  password,
  apiVersion = "2",
  timeoutMs = 30000,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!id) {
    throw new Error("profile id is required");
  }
  if (!username) {
    throw new Error("username is required");
  }
  if (!password) {
    throw new Error("password is required");
  }
  return {
    name: name || id,
    description: description || undefined,
    keywords: parseCsv(keywords),
    baseUrl: normalizedBaseUrl,
    apiVersion: String(apiVersion || "2"),
    timeoutMs: Number(timeoutMs) || 30000,
    auth: {
      type: "basic",
      username,
      password,
    },
  };
}

export function listProfiles(config) {
  return Object.entries(config.profiles || {}).map(([id, profile]) => ({
    id,
    ...profile,
  }));
}

export function getProfile(config, explicitId) {
  const profiles = config?.profiles || {};
  if (explicitId) {
    const profile = profiles[explicitId];
    if (!profile) {
      throw new CliError(`Profile not found: ${explicitId}`, {
        code: "PROFILE_NOT_FOUND",
        profileId: explicitId,
        availableProfiles: Object.keys(profiles),
      });
    }
    return { id: explicitId, ...profile };
  }
  if (config.defaultProfile && profiles[config.defaultProfile]) {
    return { id: config.defaultProfile, ...profiles[config.defaultProfile] };
  }
  const ids = Object.keys(profiles);
  if (ids.length === 1) {
    return { id: ids[0], ...profiles[ids[0]] };
  }
  if (ids.length > 1) {
    throw new CliError("Profile selection required: multiple Jira profiles are saved and no default profile is set. Use --profile <id> or `jira-cli profile use <id>`.", {
      code: "PROFILE_SELECTION_REQUIRED",
      availableProfiles: ids,
    });
  }
  throw new CliError("No Jira profiles configured. Use `jira-cli profile add <id> ...` or `jira-cli profile import-claude` first.", {
    code: "PROFILE_NOT_CONFIGURED",
  });
}

export function redactProfile(profile) {
  if (!profile) {
    return profile;
  }
  const clone = structuredClone(profile);
  if (clone.auth?.password) {
    clone.auth.password = "***";
  }
  if (clone.auth?.credentialRef) {
    clone.auth.credentialRef = {
      ...clone.auth.credentialRef,
      account: redactSecret(clone.auth.credentialRef.account),
    };
  }
  return clone;
}

export async function readClaudeJiraEnv({ claudeConfigPath, serverName = "jira-mcp" } = {}) {
  const file = claudeConfigPath || path.join(os.homedir(), ".claude.json");
  if (!fsSync.existsSync(file)) {
    throw new CliError(`Claude config not found: ${file}`, { code: "CLAUDE_CONFIG_NOT_FOUND", file });
  }
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  const servers = parsed?.mcpServers || parsed?.mcp?.servers || {};
  const server = servers[serverName] || servers["@khanglvm/jira-mcp"] || servers.jira || servers["jira-cli"];
  if (!server?.env) {
    throw new CliError(`No Jira MCP env found in ${file}`, {
      code: "CLAUDE_JIRA_ENV_NOT_FOUND",
      serverName,
      availableServers: Object.keys(servers),
    });
  }
  const env = server.env;
  return {
    file,
    serverName,
    baseUrl: env.JIRA_BASE_URL,
    username: env.JIRA_USERNAME,
    password: env.JIRA_PASSWORD,
    apiVersion: env.JIRA_API_VERSION || "2",
  };
}
