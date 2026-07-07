import fs from "node:fs/promises";
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

export function defaultCacheDir() {
  if (process.env.JIRA_CLI_CACHE_DIR) {
    return path.resolve(process.env.JIRA_CLI_CACHE_DIR);
  }
  if (process.env.JIRA_AGENT_CACHE_DIR) {
    return path.resolve(process.env.JIRA_AGENT_CACHE_DIR);
  }
  return path.join(os.homedir(), ".cache", "jira-cli");
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
  throw new CliError("No Jira profiles configured. Use `jira-cli profile add <id> ...` first.", {
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
