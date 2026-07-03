import test from "node:test";
import assert from "node:assert/strict";
import { invokeTool, resolveToolName } from "../src/tools.js";

test("resolveToolName supports short aliases", () => {
  assert.equal(resolveToolName("search"), "jira_search");
  assert.equal(resolveToolName("comments.add"), "jira_add_comment");
});

test("mutating tools dry-run without performAction", async () => {
  const result = await invokeTool({}, "jira_add_comment", { issueKey: "ABC-1", body: "hello" });
  assert.equal(result.dryRun, true);
  assert.equal(result.tool, "jira_add_comment");
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
