import test from "node:test";
import assert from "node:assert/strict";
import { buildProfile, getProfile, normalizeBaseUrl, redactProfile } from "../src/config-store.js";

test("normalizeBaseUrl trims REST API suffix", () => {
  assert.equal(normalizeBaseUrl("jira.example.com/rest/api/2"), "https://jira.example.com");
});

test("buildProfile creates basic auth profile", () => {
  const profile = buildProfile({
    id: "work",
    baseUrl: "https://jira.example.com",
    username: "alice",
    password: "secret",
  });
  assert.equal(profile.baseUrl, "https://jira.example.com");
  assert.equal(profile.auth.type, "basic");
  assert.equal(profile.auth.username, "alice");
});

test("getProfile uses default or single profile", () => {
  const config = {
    defaultProfile: "work",
    profiles: {
      work: { baseUrl: "https://jira.example.com", auth: { type: "basic" } },
    },
  };
  assert.equal(getProfile(config).id, "work");
});

test("redactProfile hides password", () => {
  const profile = redactProfile({ auth: { password: "super-secret" } });
  assert.equal(profile.auth.password, "***");
});
