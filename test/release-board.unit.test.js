import test from "node:test";
import assert from "node:assert/strict";
import { parseReleaseBoardReference, readReleaseBoard } from "../src/release-board.js";

function issue(key, { subtasks = [], parent = null, type = "Story", subtask = false } = {}) {
  return {
    id: key.replace(/\D/g, ""),
    key,
    fields: {
      summary: `Summary ${key}`,
      description: `Description ${key}`,
      status: { name: "Done", statusCategory: { name: "Done" } },
      priority: { name: "High" },
      assignee: { name: "alice", key: "alice", displayName: "Alice", active: true },
      reporter: { name: "reporter", displayName: "Reporter", active: true },
      issuetype: { name: type, subtask },
      project: { key: "BRAN" },
      labels: ["release"],
      components: [{ name: "Frontend" }],
      fixVersions: [{ id: "12378", name: "Release" }],
      created: "2026-09-01",
      updated: "2026-09-22",
      resolution: { name: "Done" },
      resolutiondate: "2026-09-22",
      parent,
      subtasks,
    },
  };
}

function client(overrides = {}) {
  return {
    profile: { baseUrl: "https://jira.example.com" },
    async getVersion(versionId) {
      return { id: versionId, projectId: "10902", name: "Release", description: "Ship it", released: false, archived: false, releaseDate: "2026-09-22" };
    },
    async getProject(projectId) {
      assert.equal(projectId, "10902");
      return { id: projectId, key: "BRAN", name: "Branding" };
    },
    async getVersionUnresolvedIssueCount() {
      return { issuesUnresolvedCount: 0 };
    },
    async getVersionRelatedIssueCounts() {
      return { issuesFixedCount: 2, issuesAffectedCount: 0 };
    },
    async search(_jql, _maxResults, startAt) {
      if (startAt === 0) return { total: 2, issues: [issue("BRAN-1", { subtasks: [issue("BRAN-11", { type: "Sub-task", subtask: true }), issue("BRAN-12", { type: "Story Bug", subtask: true })] })] };
      return { total: 2, issues: [issue("BRAN-2")] };
    },
    async getIssue(issueKey) {
      if (issueKey === "BRAN-12") {
        const error = new Error("Child unavailable");
        error.statusCode = 403;
        throw error;
      }
      return issue(issueKey, { type: "Sub-task", subtask: true });
    },
    ...overrides,
  };
}

test("parseReleaseBoardReference accepts version URLs and numeric ids", () => {
  assert.deepEqual(
    parseReleaseBoardReference("https://jira.example.com/projects/bran/versions/12378", "https://jira.example.com"),
    {
      input: "https://jira.example.com/projects/bran/versions/12378",
      versionId: "12378",
      projectKey: "BRAN",
      url: "https://jira.example.com/projects/bran/versions/12378",
    },
  );
  assert.deepEqual(parseReleaseBoardReference("12378"), {
    input: "12378",
    versionId: "12378",
    projectKey: null,
    url: null,
  });
});

test("parseReleaseBoardReference rejects another Jira host and non-version paths", () => {
  assert.throws(
    () => parseReleaseBoardReference("https://other.example.com/projects/BRAN/versions/12378", "https://jira.example.com"),
    /does not match Jira profile/,
  );
  assert.throws(
    () => parseReleaseBoardReference("https://jira.example.com/browse/BRAN-1", "https://jira.example.com"),
    /must match/,
  );
});

test("readReleaseBoard paginates direct issues and preserves partial child hydration", async () => {
  const calls = [];
  const mock = client({
    async search(jql, maxResults, startAt, fields) {
      calls.push({ jql, maxResults, startAt, fields });
      if (startAt === 0) return { total: 2, issues: [issue("BRAN-1", { subtasks: [issue("BRAN-11", { type: "Sub-task", subtask: true }), issue("BRAN-12", { type: "Story Bug", subtask: true })] })] };
      return { total: 2, issues: [issue("BRAN-2")] };
    },
  });
  const result = await readReleaseBoard(mock, {
    releaseBoard: "https://jira.example.com/projects/BRAN/versions/12378",
    pageSize: 1,
  });

  assert.deepEqual(calls.map((call) => call.startAt), [0, 1]);
  assert.match(calls[0].jql, /fixVersion = 12378/);
  assert.equal(calls[0].fields.includes("subtasks"), true);
  assert.equal(result.release.project.key, "BRAN");
  assert.equal(result.release.url, "https://jira.example.com/projects/BRAN/versions/12378");
  assert.deepEqual(result.counts, {
    direct: 2,
    children: 2,
    total: 4,
    unresolvedDirect: 0,
    affected: 0,
    byStatusCategory: { Done: 4 },
  });
  assert.deepEqual(result.issueKeys, ["BRAN-1", "BRAN-2", "BRAN-11", "BRAN-12"]);
  assert.equal(result.issues[0].children[0].summary, "Summary BRAN-11");
  assert.equal(result.issues[0].children[1].summary, "Summary BRAN-12");
  assert.equal(result.completeness.complete, false);
  assert.equal(result.completeness.childrenHydrated, 1);
  assert.deepEqual(result.completeness.errors[0], {
    parentKey: "BRAN-1",
    issueKey: "BRAN-12",
    phase: "child_hydration",
    statusCode: 403,
    error: "Error",
    message: "Child unavailable",
  });
});

test("readReleaseBoard rejects a project mismatch", async () => {
  await assert.rejects(
    readReleaseBoard(client(), { releaseBoard: "https://jira.example.com/projects/OTHER/versions/12378" }),
    /does not match Jira version project BRAN/,
  );
});

test("readReleaseBoard rejects a failed direct issue page", async () => {
  const mock = client({
    async search(_jql, _maxResults, startAt) {
      if (startAt === 0) return { total: 2, issues: [issue("BRAN-1")] };
      throw new Error("search failed");
    },
  });
  await assert.rejects(
    readReleaseBoard(mock, { releaseBoard: "12378", pageSize: 1 }),
    /search failed/,
  );
});
