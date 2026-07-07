import test from "node:test";
import assert from "node:assert/strict";
import { invokeTool, resolveToolName } from "../src/tools.js";

test("resolveToolName supports short aliases", () => {
  assert.equal(resolveToolName("search"), "jira_search");
  assert.equal(resolveToolName("comments.add"), "jira_add_comment");
  assert.equal(resolveToolName("attachments.add"), "jira_add_attachment");
  assert.equal(resolveToolName("comments.add-with-attachments"), "jira_comment_with_attachments");
  assert.equal(resolveToolName("issue.assign"), "jira_assign_issue");
  assert.equal(resolveToolName("transitions.apply-by-name"), "jira_transition_issue_by_name");
  assert.equal(resolveToolName("worklogs.add"), "jira_add_worklog");
  assert.equal(resolveToolName("links.add"), "jira_link_issues");
});

test("mutating tools dry-run without performAction", async () => {
  const result = await invokeTool({}, "jira_add_comment", { issueKey: "ABC-1", body: "hello" });
  assert.equal(result.dryRun, true);
  assert.equal(result.tool, "jira_add_comment");
});

test("comment-with-attachments dry-runs without touching Jira", async () => {
  const client = {
    async uploadAttachment() {
      throw new Error("should not upload");
    },
    async addComment() {
      throw new Error("should not comment");
    },
  };
  const result = await invokeTool(client, "comments.add-with-attachments", {
    issueKey: "ABC-1",
    body: "hello",
    attachments: ["/tmp/a.txt"],
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.tool, "jira_comment_with_attachments");
});

test("new mutating tools dry-run without touching Jira", async () => {
  const client = {
    async assignIssue() {
      throw new Error("should not assign");
    },
    async linkIssues() {
      throw new Error("should not link");
    },
  };
  const assigned = await invokeTool(client, "issue.assign", { issueKey: "ABC-1", username: "alice" });
  const linked = await invokeTool(client, "links.add", { inwardIssueKey: "ABC-1", outwardIssueKey: "ABC-2", linkType: "Blocks" });
  assert.equal(assigned.dryRun, true);
  assert.equal(linked.dryRun, true);
});

test("search maps Jira null fields safely", async () => {
  const client = {
    async search() {
      return {
        total: 1,
        startAt: 0,
        maxResults: 50,
        issues: [{ key: "ABC-1", fields: { summary: "Test", assignee: null, status: null } }],
      };
    },
  };
  const result = await invokeTool(client, "jira_search", { jql: "project = ABC" });
  assert.equal(result.issues[0].assignee, null);
  assert.equal(result.issues[0].status, null);
});

test("performAction executes mutating tool when CLI option and arg both confirm", async () => {
  let called = false;
  const client = {
    async addComment(issueKey, body) {
      called = true;
      assert.equal(issueKey, "ABC-1");
      assert.equal(body, "hello");
      return { id: "100", author: { displayName: "Alice" }, created: "now" };
    },
  };
  const result = await invokeTool(client, "comments.add", { issueKey: "ABC-1", body: "hello", performAction: true }, { performAction: true });
  assert.equal(called, true);
  assert.equal(result.commentId, "100");
});

test("comment-with-attachments uploads files and comments in one tool call", async () => {
  const calls = [];
  const client = {
    async uploadAttachment(issueKey, filePath, filename) {
      calls.push(["upload", issueKey, filePath, filename]);
      return [{ id: "200", filename: filename || "a.txt", size: 2, content: "mock://a" }];
    },
    async addComment(issueKey, body) {
      calls.push(["comment", issueKey, body]);
      return { id: "100", author: { displayName: "Alice" }, created: "now" };
    },
  };
  const result = await invokeTool(client, "comments.add-with-attachments", {
    issueKey: "ABC-1",
    body: "hello",
    attachments: [{ path: "/tmp/a.txt", filename: "evidence.txt" }],
    performAction: true,
  }, { performAction: true });
  assert.deepEqual(calls, [
    ["upload", "ABC-1", "/tmp/a.txt", "evidence.txt"],
    ["comment", "ABC-1", "hello"],
  ]);
  assert.equal(result.comment.id, "100");
  assert.equal(result.attachments.total, 1);
  assert.equal(result.attachments.files[0].filename, "evidence.txt");
});

test("transition-by-name resolves transition names before applying", async () => {
  const calls = [];
  const client = {
    async getTransitions(issueKey) {
      calls.push(["getTransitions", issueKey]);
      return { transitions: [{ id: "31", name: "Resolve Issue", to: { name: "Done" } }] };
    },
    async transitionIssue(issueKey, transitionId, comment) {
      calls.push(["transitionIssue", issueKey, transitionId, comment]);
      return {};
    },
  };
  const result = await invokeTool(client, "transitions.apply-by-name", {
    issueKey: "ABC-1",
    transition: "Done",
    comment: "Fixed",
    performAction: true,
  }, { performAction: true });
  assert.deepEqual(calls, [
    ["getTransitions", "ABC-1"],
    ["transitionIssue", "ABC-1", "31", "Fixed"],
  ]);
  assert.equal(result.transitionId, "31");
});

test("label updates use Jira update operations", async () => {
  let payload;
  const client = {
    async editIssue(issueKey, body) {
      assert.equal(issueKey, "ABC-1");
      payload = body;
      return {};
    },
  };
  const result = await invokeTool(client, "issue.labels", {
    issueKey: "ABC-1",
    add: ["agent"],
    remove: ["old"],
    performAction: true,
  }, { performAction: true });
  assert.deepEqual(payload, { update: { labels: [{ add: "agent" }, { remove: "old" }] } });
  assert.equal(result.success, true);
});

test("worklog add maps quick args to Jira worklog payload", async () => {
  let payload;
  const client = {
    async addWorklog(issueKey, body) {
      assert.equal(issueKey, "ABC-1");
      payload = body;
      return { id: "10", timeSpent: body.timeSpent, comment: body.comment };
    },
  };
  const result = await invokeTool(client, "worklogs.add", {
    issueKey: "ABC-1",
    timeSpent: "30m",
    comment: "Investigated",
    performAction: true,
  }, { performAction: true });
  assert.deepEqual(payload, { comment: "Investigated", timeSpent: "30m" });
  assert.equal(result.worklog.id, "10");
});

test("raw get and mutating request are separate safety surfaces", async () => {
  const client = {
    async rawGet(args) {
      return { method: "GET", ...args };
    },
    async rawRequest() {
      throw new Error("should not mutate");
    },
  };
  const read = await invokeTool(client, "get", { path: "/serverInfo" });
  const write = await invokeTool(client, "request", { method: "POST", path: "/issue/ABC-1/votes" });
  assert.equal(read.method, "GET");
  assert.equal(write.dryRun, true);
});

test("board users are cached and filtered for assignment lookup", async () => {
  const writes = new Map();
  const cache = {
    async get(key) {
      return writes.get(key) || null;
    },
    async set(key, value) {
      const cached = { ...value, cache: { hit: false, key } };
      writes.set(key, { ...value, cache: { hit: true, key } });
      return cached;
    },
  };
  let boardReads = 0;
  const client = {
    async getBoardIssues(boardId) {
      boardReads += 1;
      assert.equal(boardId, "130");
      return { issues: [{ fields: { project: { key: "BRAN" }, assignee: { name: "khang.le", displayName: "Khang Le", active: true } } }] };
    },
    async searchAssignableUsers({ projectKey }) {
      assert.equal(projectKey, "BRAN");
      return [
        { name: "khang.le", displayName: "Khang Le", emailAddress: "khang.le@example.com", active: true },
        { name: "someone", displayName: "Someone Else", active: true },
      ];
    },
  };
  const first = await invokeTool(client, "users.board", { boardId: "130", query: "khang" }, { cache });
  const second = await invokeTool(client, "users.board", { boardId: "130", query: "khang" }, { cache });
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.equal(boardReads, 1);
  assert.equal(second.users[0].name, "khang.le");
});

test("assign issue resolves display name from board users", async () => {
  let assigned;
  const client = {
    async getBoardIssues() {
      return { issues: [{ fields: { project: { key: "BRAN" } } }] };
    },
    async searchAssignableUsers() {
      return [{ name: "khang.le", displayName: "Khang Le", emailAddress: "khang.le@example.com", active: true }];
    },
    async assignIssue(issueKey, username) {
      assigned = { issueKey, username };
      return {};
    },
  };
  const result = await invokeTool(client, "issue.assign", {
    issueKey: "BRAN-404",
    username: "Khang Le",
    boardId: "130",
    performAction: true,
  }, { performAction: true });
  assert.deepEqual(assigned, { issueKey: "BRAN-404", username: "khang.le" });
  assert.equal(result.assignee, "khang.le");
});

test("assign issue resolves display name from issue assignable users by default", async () => {
  const calls = [];
  const client = {
    async searchAssignableUsers({ issueKey }) {
      calls.push(["searchAssignableUsers", issueKey]);
      return [{ name: "khang.le", displayName: "Khang Le", emailAddress: "khang.le@example.com", active: true }];
    },
    async assignIssue(issueKey, username) {
      calls.push(["assignIssue", issueKey, username]);
      return {};
    },
  };
  const result = await invokeTool(client, "issue.assign", {
    issueKey: "BRAN-404",
    username: "Khang Le",
    performAction: true,
  }, { performAction: true });
  assert.deepEqual(calls, [
    ["searchAssignableUsers", "BRAN-404"],
    ["assignIssue", "BRAN-404", "khang.le"],
  ]);
  assert.equal(result.assignee, "khang.le");
});

test("attachment upload supports multiple shorthand paths", async () => {
  const uploaded = [];
  const client = {
    async uploadAttachment(issueKey, filePath) {
      uploaded.push([issueKey, filePath]);
      return [{ id: String(uploaded.length), filename: filePath.split("/").pop(), size: 1, content: "mock://file" }];
    },
  };
  const result = await invokeTool(client, "attachments.add", {
    issueKey: "ABC-1",
    attachments: ["/tmp/a.txt", "/tmp/b.txt"],
    performAction: true,
  }, { performAction: true });
  assert.deepEqual(uploaded, [["ABC-1", "/tmp/a.txt"], ["ABC-1", "/tmp/b.txt"]]);
  assert.equal(result.total, 2);
});

test("attachment download saves file without base64 by default", async () => {
  const client = {
    async listAttachments() {
      return [{ id: "1", filename: "a.txt", mimeType: "text/plain", size: 2, content: "mock://a" }];
    },
    async downloadAttachment() {
      return { buffer: Buffer.from("ok"), contentType: "text/plain" };
    },
  };
  const result = await invokeTool(client, "jira_get_attachment", { issueKey: "ABC-1", filename: "a.txt" });
  assert.equal(result.base64, undefined);
  assert.equal(result.bytes, 2);
});
