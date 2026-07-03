import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JiraApiError } from "./errors.js";
import { compactValue, isMutatingTool } from "./utils.js";

function requireArg(args, key) {
  if (args[key] === undefined || args[key] === null || args[key] === "") {
    throw new Error(`${key} is required`);
  }
  return args[key];
}

function dryRun(tool, args, operation) {
  return {
    ok: true,
    dryRun: true,
    tool,
    wouldPerform: operation,
    message: "Mutation not executed. Pass --perform-action and include performAction:true in --args.",
    args: compactValue(args),
  };
}

function issueSummary(issue) {
  return {
    key: issue.key,
    id: issue.id,
    summary: issue.fields?.summary ?? null,
    description: issue.fields?.description ?? null,
    status: issue.fields?.status?.name ?? null,
    priority: issue.fields?.priority?.name ?? null,
    assignee: issue.fields?.assignee?.displayName ?? null,
    reporter: issue.fields?.reporter?.displayName ?? null,
    issueType: issue.fields?.issuetype?.name ?? null,
    project: issue.fields?.project?.key ?? null,
    labels: issue.fields?.labels ?? [],
    created: issue.fields?.created ?? null,
    updated: issue.fields?.updated ?? null,
  };
}

function cleanAttachment(a) {
  return {
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    created: a.created,
    author: a.author?.displayName ?? null,
    content: a.content,
    thumbnail: a.thumbnail,
  };
}

async function resolveAttachment(client, args) {
  if (args.issueKey && args.filename) {
    const attachments = await client.listAttachments(args.issueKey);
    const match = attachments.find((item) => item.filename === args.filename);
    if (!match) {
      throw new JiraApiError(`No attachment named "${args.filename}" found on issue ${args.issueKey}`, 404);
    }
    return match;
  }
  if (args.attachmentId) {
    if (args.issueKey) {
      const attachments = await client.listAttachments(args.issueKey);
      const match = attachments.find((item) => item.id === args.attachmentId);
      if (match) return match;
    }
    return client.getAttachmentMeta(args.attachmentId);
  }
  throw new JiraApiError("Provide either attachmentId, or both issueKey and filename", 400);
}

export const TOOL_DEFINITIONS = [
  { name: "jira_get_current_user", group: "users", mutates: false, description: "Get the authenticated Jira user.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "jira_get_user", group: "users", mutates: false, description: "Look up a Jira user by username.", inputSchema: { type: "object", properties: { username: { type: "string" } }, required: ["username"] } },
  { name: "jira_list_projects", group: "projects", mutates: false, description: "List Jira projects visible to the profile.", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "jira_get_project", group: "projects", mutates: false, description: "Get a Jira project by key or id.", inputSchema: { type: "object", properties: { projectKey: { type: "string" } }, required: ["projectKey"] } },
  { name: "jira_search", group: "issues", mutates: false, description: "Search Jira issues with JQL.", inputSchema: { type: "object", properties: { jql: { type: "string" }, maxResults: { type: "number", default: 50 }, startAt: { type: "number", default: 0 }, fields: { type: "array", items: { type: "string" } } }, required: ["jql"] } },
  { name: "jira_get_issue", group: "issues", mutates: false, description: "Get issue details by key or id.", inputSchema: { type: "object", properties: { issueKey: { type: "string" }, fields: { type: "string" }, expand: { type: "string" } }, required: ["issueKey"] } },
  { name: "jira_create_issue", group: "issues", mutates: true, description: "Create a Jira issue. Requires performAction:true.", inputSchema: { type: "object", properties: { projectKey: { type: "string" }, summary: { type: "string" }, issueType: { type: "string", default: "Task" }, description: { type: "string" }, assignee: { type: "string" }, priority: { type: "string" }, labels: { type: "array", items: { type: "string" } }, performAction: { type: "boolean" } }, required: ["projectKey", "summary"] } },
  { name: "jira_update_issue", group: "issues", mutates: true, description: "Update issue fields. Requires performAction:true.", inputSchema: { type: "object", properties: { issueKey: { type: "string" }, summary: { type: "string" }, description: { type: "string" }, assignee: { type: ["string", "null"] }, priority: { type: "string" }, labels: { type: "array", items: { type: "string" } }, performAction: { type: "boolean" } }, required: ["issueKey"] } },
  { name: "jira_delete_issue", group: "issues", mutates: true, description: "Permanently delete an issue. Requires performAction:true.", inputSchema: { type: "object", properties: { issueKey: { type: "string" }, deleteSubtasks: { type: "boolean", default: false }, performAction: { type: "boolean" } }, required: ["issueKey"] } },
  { name: "jira_get_comments", group: "comments", mutates: false, description: "List comments on an issue.", inputSchema: { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] } },
  { name: "jira_add_comment", group: "comments", mutates: true, description: "Add a comment to an issue. Requires performAction:true.", inputSchema: { type: "object", properties: { issueKey: { type: "string" }, body: { type: "string" }, performAction: { type: "boolean" } }, required: ["issueKey", "body"] } },
  { name: "jira_get_transitions", group: "transitions", mutates: false, description: "List available workflow transitions for an issue.", inputSchema: { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] } },
  { name: "jira_transition_issue", group: "transitions", mutates: true, description: "Move an issue via workflow transition id. Requires performAction:true.", inputSchema: { type: "object", properties: { issueKey: { type: "string" }, transitionId: { type: "string" }, comment: { type: "string" }, performAction: { type: "boolean" } }, required: ["issueKey", "transitionId"] } },
  { name: "jira_list_attachments", group: "attachments", mutates: false, description: "List attachments on an issue.", inputSchema: { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] } },
  { name: "jira_get_attachment", group: "attachments", mutates: false, description: "Download an attachment by id, or by issueKey and filename.", inputSchema: { type: "object", properties: { attachmentId: { type: "string" }, issueKey: { type: "string" }, filename: { type: "string" }, inlineBase64: { type: "boolean" } }, required: [] } },
];

const TOOL_ALIASES = new Map([
  ["get_issue", "jira_get_issue"],
  ["issue.get", "jira_get_issue"],
  ["search", "jira_search"],
  ["issues.search", "jira_search"],
  ["projects.list", "jira_list_projects"],
  ["project.get", "jira_get_project"],
  ["me", "jira_get_current_user"],
  ["users.me", "jira_get_current_user"],
  ["comments.list", "jira_get_comments"],
  ["comments.add", "jira_add_comment"],
  ["transitions.list", "jira_get_transitions"],
  ["transitions.apply", "jira_transition_issue"],
  ["attachments.list", "jira_list_attachments"],
  ["attachments.get", "jira_get_attachment"],
]);

function normalizeToolName(name) {
  return String(name || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[/: -]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "")
    .toLowerCase();
}

export function resolveToolName(name) {
  const raw = String(name || "").trim();
  if (TOOL_DEFINITIONS.some((tool) => tool.name === raw)) return raw;
  const normalized = normalizeToolName(raw);
  if (TOOL_ALIASES.has(normalized)) return TOOL_ALIASES.get(normalized);
  const underscore = normalized.replace(/\./g, "_");
  if (TOOL_DEFINITIONS.some((tool) => tool.name === underscore)) return underscore;
  if (TOOL_DEFINITIONS.some((tool) => tool.name === `jira_${underscore}`)) return `jira_${underscore}`;
  throw new Error(`Unknown Jira tool: ${name}`);
}

export async function invokeTool(client, toolName, rawArgs = {}, options = {}) {
  const tool = resolveToolName(toolName);
  const args = { ...(rawArgs || {}) };
  if (options.performAction && args.performAction === true) {
    args.performAction = true;
  } else if (isMutatingTool(tool)) {
    args.performAction = false;
  }
  if (isMutatingTool(tool) && !args.performAction) {
    return dryRun(tool, args, tool.replace(/^jira_/, ""));
  }

  switch (tool) {
    case "jira_get_current_user": {
      const user = await client.getCurrentUser();
      return { name: user.name, displayName: user.displayName, emailAddress: user.emailAddress, active: user.active, timeZone: user.timeZone };
    }
    case "jira_get_user": {
      const user = await client.getUser(requireArg(args, "username"));
      return { name: user.name, displayName: user.displayName, emailAddress: user.emailAddress, active: user.active, timeZone: user.timeZone };
    }
    case "jira_list_projects": {
      const projects = await client.getProjects();
      return { total: projects.length, projects: projects.map((p) => ({ key: p.key, name: p.name ?? null, id: p.id, projectType: p.projectTypeKey, lead: p.lead?.displayName ?? null })) };
    }
    case "jira_get_project": {
      const p = await client.getProject(requireArg(args, "projectKey"));
      return { key: p.key, name: p.name ?? null, id: p.id, description: p.description, projectType: p.projectTypeKey, lead: p.lead?.displayName ?? null };
    }
    case "jira_search": {
      const result = await client.search(requireArg(args, "jql"), Number(args.maxResults || 50), Number(args.startAt || 0), args.fields);
      return {
        total: result.total,
        startAt: result.startAt,
        maxResults: result.maxResults,
        issues: result.issues.map((issue) => ({
          key: issue.key,
          summary: issue.fields?.summary ?? null,
          status: issue.fields?.status?.name ?? null,
          assignee: issue.fields?.assignee?.displayName ?? null,
          priority: issue.fields?.priority?.name ?? null,
          issueType: issue.fields?.issuetype?.name ?? null,
        })),
      };
    }
    case "jira_get_issue":
      return issueSummary(await client.getIssue(requireArg(args, "issueKey"), args.fields, args.expand));
    case "jira_create_issue": {
      const result = await client.createIssue({
        project: { key: requireArg(args, "projectKey") },
        summary: requireArg(args, "summary"),
        issuetype: { name: args.issueType || "Task" },
        description: args.description,
        assignee: args.assignee ? { name: args.assignee } : undefined,
        priority: args.priority ? { name: args.priority } : undefined,
        labels: args.labels,
      });
      return { success: true, key: result.key, id: result.id, self: result.self };
    }
    case "jira_update_issue":
      await client.updateIssue(requireArg(args, "issueKey"), {
        summary: args.summary,
        description: args.description,
        assignee: args.assignee === null ? null : args.assignee ? { name: args.assignee } : undefined,
        priority: args.priority ? { name: args.priority } : undefined,
        labels: args.labels,
      });
      return { success: true, message: `Issue ${args.issueKey} updated successfully` };
    case "jira_delete_issue":
      await client.deleteIssue(requireArg(args, "issueKey"), !!args.deleteSubtasks);
      return { success: true, message: `Issue ${args.issueKey} deleted successfully` };
    case "jira_get_comments": {
      const result = await client.getComments(requireArg(args, "issueKey"));
      return { total: result.total, comments: result.comments.map((c) => ({ id: c.id, author: c.author?.displayName ?? null, body: c.body, created: c.created, updated: c.updated })) };
    }
    case "jira_add_comment": {
      const comment = await client.addComment(requireArg(args, "issueKey"), requireArg(args, "body"));
      return { success: true, commentId: comment.id, author: comment.author?.displayName ?? null, created: comment.created };
    }
    case "jira_get_transitions": {
      const result = await client.getTransitions(requireArg(args, "issueKey"));
      return { issueKey: args.issueKey, transitions: result.transitions.map((t) => ({ id: t.id, name: t.name, toStatus: t.to?.name ?? null, toStatusCategory: t.to?.statusCategory?.name ?? null })) };
    }
    case "jira_transition_issue":
      await client.transitionIssue(requireArg(args, "issueKey"), requireArg(args, "transitionId"), args.comment);
      return { success: true, message: `Issue ${args.issueKey} transitioned successfully` };
    case "jira_list_attachments": {
      const attachments = await client.listAttachments(requireArg(args, "issueKey"));
      return { issueKey: args.issueKey, total: attachments.length, attachments: attachments.map(cleanAttachment) };
    }
    case "jira_get_attachment": {
      const meta = await resolveAttachment(client, args);
      const { buffer, contentType } = await client.downloadAttachment(meta.content);
      const mimeType = meta.mimeType || contentType || "application/octet-stream";
      const dir = path.join(os.tmpdir(), "jira-cli");
      await fs.mkdir(dir, { recursive: true });
      const safeName = path.basename(meta.filename || `attachment-${meta.id}`);
      const savedPath = path.join(dir, `${meta.id}-${safeName}`);
      await fs.writeFile(savedPath, buffer);
      return {
        id: meta.id,
        filename: meta.filename,
        mimeType,
        size: meta.size,
        bytes: buffer.byteLength,
        created: meta.created,
        author: meta.author?.displayName ?? null,
        savedPath,
        base64: args.inlineBase64 === true ? buffer.toString("base64") : undefined,
      };
    }
    default:
      throw new Error(`Unhandled Jira tool: ${tool}`);
  }
}
