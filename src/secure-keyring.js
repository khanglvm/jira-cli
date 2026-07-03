import crypto from "node:crypto";
import path from "node:path";
import { Entry } from "@napi-rs/keyring";
import { CliError } from "./errors.js";

const KEYCHAIN_SECRET_VERSION = 1;
const KEYCHAIN_SECRET_KIND = "jira-cli.profile-auth";
const DEFAULT_KEYCHAIN_SERVICE = "com.khanglvm.jira-cli";

function keychainMode() {
  const value = String(process.env.JIRA_CLI_KEYCHAIN_MODE || process.env.JIRA_AGENT_KEYCHAIN_MODE || "required").toLowerCase();
  return ["required", "optional", "disabled"].includes(value) ? value : "required";
}

function serviceName() {
  return process.env.JIRA_CLI_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;
}

function scope(configPath) {
  return crypto.createHash("sha256").update(path.resolve(configPath)).digest("hex").slice(0, 16);
}

function hasRef(auth) {
  return !!(auth?.credentialRef?.service && auth?.credentialRef?.account);
}

function credentialRef(configPath, profileId, auth) {
  if (hasRef(auth)) {
    return {
      service: String(auth.credentialRef.service),
      account: String(auth.credentialRef.account),
      schemaVersion: Number(auth.credentialRef.schemaVersion || KEYCHAIN_SECRET_VERSION),
    };
  }
  return {
    service: serviceName(),
    account: `profile-auth:${scope(configPath)}:${profileId}`,
    schemaVersion: KEYCHAIN_SECRET_VERSION,
  };
}

function encode(payload) {
  return JSON.stringify({
    version: KEYCHAIN_SECRET_VERSION,
    kind: KEYCHAIN_SECRET_KIND,
    payload,
  });
}

function decode(raw) {
  const parsed = JSON.parse(raw);
  if (parsed?.kind !== KEYCHAIN_SECRET_KIND) {
    throw new Error("Unsupported keychain payload kind");
  }
  return parsed.payload || {};
}

function isNotFound(err) {
  return /not found|no matching|could not be found|item/i.test(String(err?.message || err));
}

export function secureProfileForStorage({ configPath, profileId, profile }) {
  const mode = keychainMode();
  const clone = structuredClone(profile);
  const password = clone.auth?.password;
  if (!password) {
    return { profile: clone, keychain: { used: false, mode, reason: "no-sensitive-fields" } };
  }
  if (mode === "disabled") {
    clone.auth.credentialStore = "config-inline";
    return { profile: clone, keychain: { used: false, mode, reason: "disabled" } };
  }
  const ref = credentialRef(configPath, profileId, clone.auth);
  try {
    new Entry(ref.service, ref.account).setPassword(encode({ password: String(password) }));
    delete clone.auth.password;
    clone.auth.credentialStore = "os-keychain";
    clone.auth.credentialRef = ref;
    return { profile: clone, keychain: { used: true, mode, ref } };
  } catch (err) {
    if (mode === "optional") {
      clone.auth.credentialStore = "config-inline";
      return { profile: clone, keychain: { used: false, mode, reason: "store-failed-optional", keychainMessage: err?.message || String(err) } };
    }
    throw new CliError("Failed to write Jira credentials to OS keychain", {
      code: "KEYCHAIN_ERROR",
      profileId,
      keychainMessage: err?.message || String(err),
    });
  }
}

export function hydrateProfileFromKeychain({ configPath, profile }) {
  const clone = structuredClone(profile);
  if (clone.auth?.password) {
    return clone;
  }
  if (clone.auth?.type !== "basic") {
    return clone;
  }
  if (keychainMode() === "disabled") {
    throw new CliError("Profile requires OS keychain credentials but keychain mode is disabled", {
      code: "KEYCHAIN_DISABLED",
      profileId: clone.id,
    });
  }
  const ref = credentialRef(configPath, clone.id, clone.auth);
  try {
    const payload = decode(new Entry(ref.service, ref.account).getPassword());
    clone.auth.password = payload.password;
    return clone;
  } catch (err) {
    if (isNotFound(err)) {
      throw new CliError("Profile credentials are missing in OS keychain", {
        code: "KEYCHAIN_SECRET_NOT_FOUND",
        profileId: clone.id,
        service: ref.service,
        account: ref.account,
      });
    }
    throw new CliError("Failed to read Jira credentials from OS keychain", {
      code: "KEYCHAIN_ERROR",
      profileId: clone.id,
      keychainMessage: err?.message || String(err),
    });
  }
}

export function removeProfileFromKeychain({ configPath, profileId, profile }) {
  if (!profile?.auth || profile.auth.credentialStore === "config-inline") {
    return { removed: false, reason: "inline-storage" };
  }
  const ref = credentialRef(configPath, profileId, profile.auth);
  try {
    new Entry(ref.service, ref.account).deletePassword();
    return { removed: true, service: ref.service, account: ref.account };
  } catch (err) {
    if (isNotFound(err)) {
      return { removed: false, reason: "not-found", service: ref.service, account: ref.account };
    }
    throw new CliError("Failed to delete Jira credentials from OS keychain", {
      code: "KEYCHAIN_ERROR",
      profileId,
      keychainMessage: err?.message || String(err),
    });
  }
}
