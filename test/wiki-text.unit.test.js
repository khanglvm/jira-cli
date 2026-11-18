import test from "node:test";
import assert from "node:assert/strict";
import { buildProfile } from "../src/config-store.js";
import { JiraClient } from "../src/jira-client.js";
import { invokeTool } from "../src/tools.js";
import { encodeSupplementaryCharacters } from "../src/wiki-text.js";

// Records each request body the client puts on the wire.
function recordingClient(profileSettings = { supplementaryCharacters: "entities" }) {
  const sent = [];
  const client = new JiraClient({ baseUrl: "https://jira.example.test", auth: { username: "u", password: "p" }, ...profileSettings });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init.body });
    return new Response(JSON.stringify({ id: "1" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  return { client, sent, restore: () => { globalThis.fetch = realFetch; } };
}

async function sendEveryCommentWrite(client) {
  await client.addComment("TEST-1", "🤖\nĐã sửa.");
  await client.updateComment("TEST-1", "9", "🤖\nĐã sửa.");
  await client.transitionIssue("TEST-1", "31", "🤖\nĐã sửa.");
  await client.transitionIssue("TEST-1", "31", undefined, undefined, { comment: [{ add: { body: "🤖 update" } }] });
  await client.editIssue("TEST-1", { update: { comment: [{ add: { body: "🤖 edit" } }] } });
  await client.addWorklog("TEST-1", { timeSpent: "1h", comment: "🤖 log" });
  await client.updateWorklog("TEST-1", "7", { timeSpent: "1h", comment: "🤖 log" });
  await client.linkIssues({ type: { name: "Relates" }, inwardIssue: { key: "A-1" }, outwardIssue: { key: "B-1" }, comment: { body: "🤖 link" } });
}

const hasFourByteUtf8 = (body) => Buffer.from(body, "utf8").some((byte) => byte >= 0xf0);

test("encodeSupplementaryCharacters turns 4-byte characters into numeric entities and keeps Vietnamese text", () => {
  assert.equal(encodeSupplementaryCharacters("🤖\nĐã sửa lỗi → xong ✅"), "&#129302;\nĐã sửa lỗi → xong ✅");
  assert.equal(encodeSupplementaryCharacters(undefined), undefined);
});

test("an entities profile never sends 4-byte UTF-8 in any comment-bearing write", async () => {
  const { client, sent, restore } = recordingClient();
  try {
    await sendEveryCommentWrite(client);
  } finally {
    restore();
  }
  assert.equal(sent.length, 8);
  for (const request of sent) {
    assert.ok(!hasFourByteUtf8(request.body), `4-byte UTF-8 sent to ${request.url}`);
    assert.ok(request.body.includes("&#129302;"), `marker missing in ${request.url}`);
  }
});

test("a profile without the setting sends the original Unicode", async () => {
  const { client, sent, restore } = recordingClient({});
  try {
    await sendEveryCommentWrite(client);
  } finally {
    restore();
  }
  assert.equal(sent.length, 8);
  for (const request of sent) {
    assert.ok(request.body.includes("🤖") && !request.body.includes("&#129302;"), `body changed for ${request.url}`);
  }
});

test("a transition encodes the update.comment operations that replace its shorthand comment", async () => {
  const { client, sent, restore } = recordingClient();
  try {
    await client.transitionIssue("TEST-1", "31", "🤖 shorthand", { resolution: { name: "Done" } }, {
      comment: [{ add: { body: "🤖 operation" } }],
      labels: [{ add: "qc" }],
    });
  } finally {
    restore();
  }
  assert.deepEqual(JSON.parse(sent[0].body), {
    transition: { id: "31" },
    update: {
      comment: [{ add: { body: "&#129302; operation" } }],
      labels: [{ add: "qc" }],
    },
    fields: { resolution: { name: "Done" } },
  });
});

test("named issue edits encode comment add and edit operations in the final payload", async () => {
  const { client, sent, restore } = recordingClient();
  try {
    await invokeTool(client, "jira_update_issue", {
      issueKey: "TEST-1",
      summary: "Giữ 🤖 trong tiêu đề",
      update: { comment: [{ add: { body: "🤖 add" } }, { edit: { id: "5", body: "🤖 edit" } }] },
      performAction: true,
    }, { performAction: true });
  } finally {
    restore();
  }
  assert.deepEqual(JSON.parse(sent[0].body), {
    fields: { summary: "Giữ 🤖 trong tiêu đề" },
    update: { comment: [{ add: { body: "&#129302; add" } }, { edit: { id: "5", body: "&#129302; edit" } }] },
  });
});

test("comment reads keep the stored body and add a decoded view outside literal blocks", async () => {
  const stored = "&#129302;\nĐã sửa &amp; &#233; {code:js}&#x1F916;{code} {noformat}&#129302;{noformat}";
  const client = { getComments: async () => ({ total: 2, comments: [{ id: "1", body: stored }, { id: "2", body: "Không có emoji." }] }) };
  const result = await invokeTool(client, "jira_get_comments", { issueKey: "TEST-1" });
  assert.equal(result.comments[0].body, stored);
  assert.equal(result.comments[0].decodedBody, "🤖\nĐã sửa &amp; &#233; {code:js}&#x1F916;{code} {noformat}&#129302;{noformat}");
  assert.equal("decodedBody" in result.comments[1], false);
});

test("show comment and worklog reads give the same stored and decoded contract", async () => {
  const client = {
    getIssue: async () => ({ key: "TEST-1", id: "10", fields: { comment: { total: 1, comments: [{ id: "1", body: "&#129302; xong {code}&#129302;" }] } } }),
    getWorklogs: async () => ({ total: 1, worklogs: [{ id: "7", comment: "&#129302; log" }] }),
  };
  const issue = await invokeTool(client, "jira_get_issue", { issueKey: "TEST-1", fields: "comment" });
  assert.deepEqual([issue.comment.comments[0].body, issue.comment.comments[0].decodedBody], ["&#129302; xong {code}&#129302;", "🤖 xong {code}&#129302;"]);
  const worklogs = await invokeTool(client, "jira_get_worklogs", { issueKey: "TEST-1" });
  assert.deepEqual([worklogs.worklogs[0].comment, worklogs.worklogs[0].decodedComment], ["&#129302; log", "🤖 log"]);
});

test("profiles accept only the known supplementary-character modes", () => {
  const base = { id: "work", baseUrl: "https://jira.example.test", username: "u", password: "p" };
  assert.equal(buildProfile({ ...base, supplementaryCharacters: "entities" }).supplementaryCharacters, "entities");
  assert.equal(buildProfile(base).supplementaryCharacters, undefined);
  assert.throws(() => buildProfile({ ...base, supplementaryCharacters: "html" }), /unicode, entities/);
});
