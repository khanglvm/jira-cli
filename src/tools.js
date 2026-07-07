import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JiraApiError } from "./errors.js";
import { compactValue, isMutatingTool, parseCsv } from "./utils.js";

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

function userSummary(user) {
  if (!user) return null;
  return {
    name: user.name ?? null,
    key: user.key ?? null,
    displayName: user.displayName ?? null,
    emailAddress: user.emailAddress ?? null,
    active: user.active ?? null,
    timeZone: user.timeZone ?? null,
  };
}

function issueSummary(issue) {
  return {
    key: issue.key,
    id: issue.id,
    summary: issue.fields?.summary ?? null,
    description: issue.fields?.description ?? null,
    status: issue.fields?.status?.name ?? null,
    statusCategory: issue.fields?.status?.statusCategory?.name ?? null,
    priority: issue.fields?.priority?.name ?? null,
    assignee: issue.fields?.assignee?.displayName ?? null,
    assigneeName: issue.fields?.assignee?.name ?? null,
    reporter: issue.fields?.reporter?.displayName ?? null,
    issueType: issue.fields?.issuetype?.name ?? null,
    project: issue.fields?.project?.key ?? null,
    labels: issue.fields?.labels ?? [],
    components: (issue.fields?.components || []).map((item) => item.name),
    fixVersions: (issue.fields?.fixVersions || []).map((item) => item.name),
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

function cleanWorklog(worklog) {
  return {
    id: worklog.id,
    issueId: worklog.issueId,
    author: userSummary(worklog.author),
    updateAuthor: userSummary(worklog.updateAuthor),
    comment: worklog.comment ?? null,
    started: worklog.started ?? null,
    timeSpent: worklog.timeSpent ?? null,
    timeSpentSeconds: worklog.timeSpentSeconds ?? null,
    created: worklog.created ?? null,
    updated: worklog.updated ?? null,
  };
}

function pickIssueFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function attachmentInputs(args, { required = false } = {}) {
  const inputs = [];
  const addInput = (item) => {
    if (!item) return;
    if (typeof item === "string") {
      inputs.push({ path: item });
      return;
    }
    if (typeof item === "object") {
      inputs.push({
        path: item.path || item.filePath,
        filename: item.filename,
      });
    }
  };

  addInput(args.filePath ? { path: args.filePath, filename: args.filename } : null);
  addInput(args.path ? { path: args.path, filename: args.filename } : null);
  if (Array.isArray(args.filePaths)) {
    args.filePaths.forEach(addInput);
  }
  if (Array.isArray(args.attachments)) {
    args.attachments.forEach(addInput);
  } else {
    addInput(args.attachments);
  }

  const validInputs = inputs.filter((item) => item.path);
  if (required && validInputs.length === 0) {
    throw new Error("filePath or attachments is required");
  }
  return validInputs;
}

function toArray(value) {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function worklogPayload(args) {
  const payload = pickIssueFields({
    comment: args.comment,
    started: args.started,
    timeSpent: args.timeSpent,
    timeSpentSeconds: args.timeSpentSeconds,
    visibility: args.visibility,
  });
  if (!payload.timeSpent && !payload.timeSpentSeconds) {
    throw new Error("timeSpent or timeSpentSeconds is required");
  }
  return payload;
}

function remoteLinkPayload(args) {
  return pickIssueFields({
    globalId: args.globalId,
    application: args.application || (args.applicationType || args.applicationName ? {
      type: args.applicationType || "external",
      name: args.applicationName || "External Link",
    } : undefined),
    relationship: args.relationship,
    object: args.object || pickIssueFields({
      url: requireArg(args, "url"),
      title: requireArg(args, "title"),
      summary: args.summary,
      icon: args.icon,
      status: args.status,
    }),
  });
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

async function addAttachments(client, args, { required = false } = {}) {
  const issueKey = requireArg(args, "issueKey");
  const uploaded = [];
  for (const input of attachmentInputs(args, { required })) {
    const result = await client.uploadAttachment(issueKey, input.path, input.filename);
    uploaded.push(...(Array.isArray(result) ? result : [result]));
  }
  return uploaded.map(cleanAttachment);
}

async function resolveUsername(client, value) {
  if (value === undefined) return undefined;
  if (value === null || value === "none" || value === "unassigned") return null;
  if (value === "auto" || value === "automatic") return "-1";
  if (value === "me" || value === "currentUser()") {
    const user = await client.getCurrentUser();
    return user.name;
  }
  return value;
}

function userIdentity(user) {
  return (user?.name || user?.key || user?.emailAddress || user?.displayName || "").toLowerCase();
}

function mergeUsers(existing, user, source) {
  const summary = userSummary(user);
  if (!summary?.name && !summary?.key && !summary?.emailAddress && !summary?.displayName) return;
  const key = userIdentity(summary);
  if (!existing.has(key)) {
    existing.set(key, { ...summary, sources: [source] });
    return;
  }
  const current = existing.get(key);
  if (!current.sources.includes(source)) current.sources.push(source);
}

function filterUsers(users, query, maxResults) {
  const q = String(query || "").trim().toLowerCase();
  const filtered = q
    ? users.filter((user) => [user.name, user.key, user.displayName, user.emailAddress].some((value) => String(value || "").toLowerCase().includes(q)))
    : users;
  return filtered.slice(0, Number(maxResults || filtered.length || 1000));
}

function exactUserMatch(users, query) {
  const q = String(query || "").trim().toLowerCase();
  return users.find((user) => [user.name, user.key, user.displayName, user.emailAddress].some((value) => String(value || "").toLowerCase() === q));
}

async function loadBoardUsers(client, args, options = {}, cacheKey) {
  const boardId = args.boardId;
  const projectKeys = new Set(parseCsv(args.projectKeys || args.projectKey));
  const observed = new Map();

  if (boardId) {
    const boardIssues = await client.getBoardIssues(boardId, {
      maxResults: Number(args.issueSampleSize || 100),
      fields: "project,assignee,reporter",
    });
    for (const issue of boardIssues.issues || boardIssues.values || []) {
      const projectKey = issue.fields?.project?.key;
      if (projectKey) projectKeys.add(projectKey);
      mergeUsers(observed, issue.fields?.assignee, "board-assignee");
      mergeUsers(observed, issue.fields?.reporter, "board-reporter");
    }
  }

  const users = new Map(observed);
  if (args.issueKey) {
    for (const user of await client.searchAssignableUsers({ issueKey: args.issueKey, maxResults: 1000 })) {
      mergeUsers(users, user, "assignable-issue");
    }
  }
  for (const projectKey of projectKeys) {
    for (const user of await client.searchAssignableUsers({ projectKey, maxResults: 1000 })) {
      mergeUsers(users, user, `assignable-project:${projectKey}`);
    }
  }

  const value = {
    boardId: boardId ?? null,
    issueKey: args.issueKey ?? null,
    projectKeys: [...projectKeys],
    observedUserCount: observed.size,
    users: [...users.values()].sort((a, b) => String(a.displayName || a.name).localeCompare(String(b.displayName || b.name))),
  };
  if (options.cache && (boardId || projectKeys.size > 0 || args.issueKey)) {
    return options.cache.set(cacheKey, value);
  }
  return value;
}

async function getBoardUsers(client, args, options = {}) {
  const projectKeys = parseCsv(args.projectKeys || args.projectKey);
  const key = `board-users-${args.boardId || "none"}-${projectKeys.join("-") || "no-projects"}-${args.issueKey || "no-issue"}`;
  const cached = options.cache && (args.boardId || projectKeys.length > 0 || args.issueKey)
    ? await options.cache.get(key, { refresh: !!args.refreshCache })
    : null;
  const full = cached || await loadBoardUsers(client, args, options, key);
  const users = filterUsers(full.users || [], args.query, args.maxResults);
  return {
    ...full,
    total: users.length,
    users,
    cache: full.cache || { hit: false },
  };
}

async function resolveAssignableUsername(client, args, options = {}) {
  const value = args.username ?? args.person ?? args.assignee;
  if (value === undefined || value === null || ["me", "currentUser()", "auto", "automatic", "none", "unassigned"].includes(String(value))) {
    return resolveUsername(client, value);
  }
  if (!args.boardId && !args.projectKey && !args.projectKeys && !args.issueKey) {
    return value;
  }
  const boardUsers = await getBoardUsers(client, { ...args, query: value, maxResults: 20 }, options);
  const exact = exactUserMatch(boardUsers.users, value);
  if (exact) return exact.name || exact.key;
  if (boardUsers.users.length === 1) return boardUsers.users[0].name || boardUsers.users[0].key;
  if (boardUsers.users.length > 1) {
    throw new Error(`Ambiguous Jira user "${value}". Matches: ${boardUsers.users.map((user) => `${user.displayName} (${user.name || user.key})`).join(", ")}`);
  }
  throw new Error(`No assignable Jira user matching "${value}" found in assignable user cache`);
}

async function transitionByName(client, args) {
  const issueKey = requireArg(args, "issueKey");
  const wanted = String(requireArg(args, "transition")).toLowerCase();
  const result = await client.getTransitions(issueKey);
  const match = result.transitions.find((transition) => (
    String(transition.id).toLowerCase() === wanted ||
    String(transition.name).toLowerCase() === wanted ||
    String(transition.to?.name || "").toLowerCase() === wanted
  ));
  if (!match) {
    throw new Error(`No transition matching "${args.transition}" for ${issueKey}. Available: ${result.transitions.map((item) => `${item.id}:${item.name}`).join(", ")}`);
  }
  await client.transitionIssue(issueKey, match.id, args.comment, args.fields, args.update);
  return { success: true, issueKey, transitionId: match.id, transitionName: match.name, toStatus: match.to?.name ?? null };
}

function def(name, group, mutates, description, properties = {}, required = []) {
  return { name, group, mutates, description, inputSchema: { type: "object", properties, required } };
}

const p = {
  issueKey: { type: "string" },
  performAction: { type: "boolean" },
};

export const TOOL_DEFINITIONS = [
  def("jira_get_current_user", "users", false, "Get the authenticated Jira user."),
  def("jira_get_user", "users", false, "Look up a Jira user by username.", { username: { type: "string" } }, ["username"]),
  def("jira_search_users", "users", false, "Search Jira users by username/query.", { username: { type: "string" }, query: { type: "string" }, startAt: { type: "number" }, maxResults: { type: "number" }, includeActive: { type: "boolean" }, includeInactive: { type: "boolean" } }),
  def("jira_search_assignable_users", "users", false, "Search users assignable to a project or issue.", { username: { type: "string" }, query: { type: "string" }, projectKey: { type: "string" }, issueKey: p.issueKey, startAt: { type: "number" }, maxResults: { type: "number" } }),
  def("jira_get_board_users", "users", false, "List users available for assignment in a board/project, cached for 30 days by default.", { boardId: { type: "string" }, projectKey: { type: "string" }, projectKeys: { type: "string" }, issueKey: p.issueKey, query: { type: "string" }, maxResults: { type: "number" }, issueSampleSize: { type: "number" }, refreshCache: { type: "boolean" } }),
  def("jira_get_server_info", "metadata", false, "Get Jira Server information."),
  def("jira_get_fields", "metadata", false, "List Jira fields visible to the user."),
  def("jira_get_priorities", "metadata", false, "List Jira priorities."),
  def("jira_get_statuses", "metadata", false, "List Jira statuses."),
  def("jira_get_issue_types", "metadata", false, "List Jira issue types."),
  def("jira_get_create_meta", "metadata", false, "Get issue create metadata.", { projectKeys: { type: "string" }, projectIds: { type: "string" }, issueTypeIds: { type: "string" }, issueTypeNames: { type: "string" }, expand: { type: "string" } }),
  def("jira_get_edit_meta", "metadata", false, "Get issue edit metadata.", { issueKey: p.issueKey }, ["issueKey"]),
  def("jira_list_projects", "projects", false, "List Jira projects visible to the profile."),
  def("jira_get_project", "projects", false, "Get a Jira project by key or id.", { projectKey: { type: "string" } }, ["projectKey"]),
  def("jira_search", "issues", false, "Search Jira issues with JQL.", { jql: { type: "string" }, maxResults: { type: "number", default: 50 }, startAt: { type: "number", default: 0 }, fields: { type: "array", items: { type: "string" } } }, ["jql"]),
  def("jira_get_issue", "issues", false, "Get issue details by key or id.", { issueKey: p.issueKey, fields: { type: "string" }, expand: { type: "string" } }, ["issueKey"]),
  def("jira_create_issue", "issues", true, "Create a Jira issue. Requires performAction:true.", { projectKey: { type: "string" }, summary: { type: "string" }, issueType: { type: "string", default: "Task" }, description: { type: "string" }, assignee: { type: "string" }, priority: { type: "string" }, labels: { type: "array", items: { type: "string" } }, fields: { type: "object" }, update: { type: "object" }, performAction: p.performAction }, ["projectKey", "summary"]),
  def("jira_update_issue", "issues", true, "Update issue fields or raw edit payload. Requires performAction:true.", { issueKey: p.issueKey, summary: { type: "string" }, description: { type: "string" }, assignee: { type: ["string", "null"] }, priority: { type: "string" }, labels: { type: "array", items: { type: "string" } }, fields: { type: "object" }, update: { type: "object" }, notifyUsers: { type: "boolean" }, performAction: p.performAction }, ["issueKey"]),
  def("jira_assign_issue", "issues", true, "Assign an issue to a username/person, with optional board/project cached user resolution. Requires performAction:true.", { issueKey: p.issueKey, username: { type: ["string", "null"] }, person: { type: "string" }, boardId: { type: "string" }, projectKey: { type: "string" }, projectKeys: { type: "string" }, refreshCache: { type: "boolean" }, performAction: p.performAction }, ["issueKey"]),
  def("jira_update_labels", "issues", true, "Add, remove, or set issue labels. Requires performAction:true.", { issueKey: p.issueKey, add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } }, set: { type: "array", items: { type: "string" } }, performAction: p.performAction }, ["issueKey"]),
  def("jira_delete_issue", "issues", true, "Permanently delete an issue. Requires performAction:true.", { issueKey: p.issueKey, deleteSubtasks: { type: "boolean", default: false }, performAction: p.performAction }, ["issueKey"]),
  def("jira_get_comments", "comments", false, "List comments on an issue.", { issueKey: p.issueKey }, ["issueKey"]),
  def("jira_add_comment", "comments", true, "Add a comment to an issue. Requires performAction:true.", { issueKey: p.issueKey, body: { type: "string" }, performAction: p.performAction }, ["issueKey", "body"]),
  def("jira_update_comment", "comments", true, "Update a comment body. Requires performAction:true.", { issueKey: p.issueKey, commentId: { type: "string" }, body: { type: "string" }, performAction: p.performAction }, ["issueKey", "commentId", "body"]),
  def("jira_delete_comment", "comments", true, "Delete a comment. Requires performAction:true.", { issueKey: p.issueKey, commentId: { type: "string" }, performAction: p.performAction }, ["issueKey", "commentId"]),
  def("jira_comment_with_attachments", "common", true, "Upload local files then add a comment in one call. Requires performAction:true.", { issueKey: p.issueKey, body: { type: "string" }, attachments: { type: "array", items: { oneOf: [{ type: "string" }, { type: "object" }] } }, filePath: { type: "string" }, filename: { type: "string" }, performAction: p.performAction }, ["issueKey", "body"]),
  def("jira_get_transitions", "transitions", false, "List available workflow transitions for an issue.", { issueKey: p.issueKey }, ["issueKey"]),
  def("jira_transition_issue", "transitions", true, "Move an issue via workflow transition id. Requires performAction:true.", { issueKey: p.issueKey, transitionId: { type: "string" }, comment: { type: "string" }, fields: { type: "object" }, update: { type: "object" }, performAction: p.performAction }, ["issueKey", "transitionId"]),
  def("jira_transition_issue_by_name", "common", true, "Move an issue by transition id, transition name, or destination status. Requires performAction:true.", { issueKey: p.issueKey, transition: { type: "string" }, comment: { type: "string" }, fields: { type: "object" }, update: { type: "object" }, performAction: p.performAction }, ["issueKey", "transition"]),
  def("jira_list_attachments", "attachments", false, "List attachments on an issue.", { issueKey: p.issueKey }, ["issueKey"]),
  def("jira_add_attachment", "attachments", true, "Upload one or more local files to an issue. Requires performAction:true.", { issueKey: p.issueKey, filePath: { type: "string" }, filename: { type: "string" }, attachments: { type: "array", items: { oneOf: [{ type: "string" }, { type: "object" }] } }, performAction: p.performAction }, ["issueKey"]),
  def("jira_get_attachment", "attachments", false, "Download an attachment by id, or by issueKey and filename.", { attachmentId: { type: "string" }, issueKey: p.issueKey, filename: { type: "string" }, inlineBase64: { type: "boolean" } }),
  def("jira_get_voters", "votes", false, "List voters for an issue.", { issueKey: p.issueKey }, ["issueKey"]),
  def("jira_add_vote", "votes", true, "Vote for an issue as the current user. Requires performAction:true.", { issueKey: p.issueKey, performAction: p.performAction }, ["issueKey"]),
  def("jira_remove_vote", "votes", true, "Remove the current user's vote. Requires performAction:true.", { issueKey: p.issueKey, performAction: p.performAction }, ["issueKey"]),
  def("jira_get_watchers", "watchers", false, "List watchers for an issue.", { issueKey: p.issueKey }, ["issueKey"]),
  def("jira_add_watcher", "watchers", true, "Add a watcher by username or me. Requires performAction:true.", { issueKey: p.issueKey, username: { type: "string" }, performAction: p.performAction }, ["issueKey", "username"]),
  def("jira_remove_watcher", "watchers", true, "Remove a watcher by username or me. Requires performAction:true.", { issueKey: p.issueKey, username: { type: "string" }, performAction: p.performAction }, ["issueKey", "username"]),
  def("jira_get_worklogs", "worklogs", false, "List issue worklogs.", { issueKey: p.issueKey }, ["issueKey"]),
  def("jira_add_worklog", "worklogs", true, "Add a worklog. Requires performAction:true.", { issueKey: p.issueKey, timeSpent: { type: "string" }, timeSpentSeconds: { type: "number" }, comment: { type: "string" }, started: { type: "string" }, visibility: { type: "object" }, adjustEstimate: { type: "string" }, newEstimate: { type: "string" }, reduceBy: { type: "string" }, performAction: p.performAction }, ["issueKey"]),
  def("jira_update_worklog", "worklogs", true, "Update a worklog. Requires performAction:true.", { issueKey: p.issueKey, worklogId: { type: "string" }, timeSpent: { type: "string" }, timeSpentSeconds: { type: "number" }, comment: { type: "string" }, started: { type: "string" }, visibility: { type: "object" }, adjustEstimate: { type: "string" }, newEstimate: { type: "string" }, performAction: p.performAction }, ["issueKey", "worklogId"]),
  def("jira_delete_worklog", "worklogs", true, "Delete a worklog. Requires performAction:true.", { issueKey: p.issueKey, worklogId: { type: "string" }, adjustEstimate: { type: "string" }, newEstimate: { type: "string" }, increaseBy: { type: "string" }, performAction: p.performAction }, ["issueKey", "worklogId"]),
  def("jira_get_issue_link_types", "links", false, "List issue link types.", {}),
  def("jira_get_issue_link", "links", false, "Get an issue link by id.", { linkId: { type: "string" } }, ["linkId"]),
  def("jira_link_issues", "links", true, "Create an issue link. Requires performAction:true.", { inwardIssueKey: p.issueKey, outwardIssueKey: p.issueKey, linkType: { type: "string" }, comment: { type: "string" }, performAction: p.performAction }, ["inwardIssueKey", "outwardIssueKey", "linkType"]),
  def("jira_delete_issue_link", "links", true, "Delete an issue link by id. Requires performAction:true.", { linkId: { type: "string" }, performAction: p.performAction }, ["linkId"]),
  def("jira_get_remote_links", "remote-links", false, "List remote links on an issue, optionally by globalId.", { issueKey: p.issueKey, globalId: { type: "string" } }, ["issueKey"]),
  def("jira_get_remote_link", "remote-links", false, "Get one remote link by id.", { issueKey: p.issueKey, linkId: { type: "string" } }, ["issueKey", "linkId"]),
  def("jira_upsert_remote_link", "remote-links", true, "Create/update a remote link by URL/globalId. Requires performAction:true.", { issueKey: p.issueKey, url: { type: "string" }, title: { type: "string" }, globalId: { type: "string" }, relationship: { type: "string" }, summary: { type: "string" }, applicationType: { type: "string" }, applicationName: { type: "string" }, object: { type: "object" }, application: { type: "object" }, performAction: p.performAction }, ["issueKey", "url", "title"]),
  def("jira_update_remote_link", "remote-links", true, "Update a remote link by internal id. Requires performAction:true.", { issueKey: p.issueKey, linkId: { type: "string" }, url: { type: "string" }, title: { type: "string" }, globalId: { type: "string" }, relationship: { type: "string" }, summary: { type: "string" }, object: { type: "object" }, application: { type: "object" }, performAction: p.performAction }, ["issueKey", "linkId", "url", "title"]),
  def("jira_delete_remote_link", "remote-links", true, "Delete a remote link by id or globalId. Requires performAction:true.", { issueKey: p.issueKey, linkId: { type: "string" }, globalId: { type: "string" }, performAction: p.performAction }, ["issueKey"]),
  def("jira_list_boards", "agile", false, "List Jira Agile boards.", { startAt: { type: "number" }, maxResults: { type: "number" }, type: { type: "string" }, name: { type: "string" }, projectKeyOrId: { type: "string" } }),
  def("jira_get_board", "agile", false, "Get a Jira Agile board.", { boardId: { type: "string" } }, ["boardId"]),
  def("jira_get_board_issues", "agile", false, "List issues for a board.", { boardId: { type: "string" }, startAt: { type: "number" }, maxResults: { type: "number" }, jql: { type: "string" }, validateQuery: { type: "boolean" }, fields: { type: "string" }, expand: { type: "string" } }, ["boardId"]),
  def("jira_get_backlog_issues", "agile", false, "List backlog issues for a board.", { boardId: { type: "string" }, startAt: { type: "number" }, maxResults: { type: "number" }, jql: { type: "string" }, validateQuery: { type: "boolean" }, fields: { type: "string" }, expand: { type: "string" } }, ["boardId"]),
  def("jira_get_sprints", "agile", false, "List sprints for a board.", { boardId: { type: "string" }, startAt: { type: "number" }, maxResults: { type: "number" }, state: { type: "string" } }, ["boardId"]),
  def("jira_get_sprint_issues", "agile", false, "List issues for a sprint.", { sprintId: { type: "string" }, startAt: { type: "number" }, maxResults: { type: "number" }, jql: { type: "string" }, validateQuery: { type: "boolean" }, fields: { type: "string" }, expand: { type: "string" } }, ["sprintId"]),
  def("jira_move_issues_to_sprint", "agile", true, "Move up to 50 issues to an open/active sprint. Requires performAction:true.", { sprintId: { type: "string" }, issues: { type: "array", items: { type: "string" } }, performAction: p.performAction }, ["sprintId", "issues"]),
  def("jira_move_issues_to_backlog", "agile", true, "Move up to 50 issues to backlog. Requires performAction:true.", { issues: { type: "array", items: { type: "string" } }, performAction: p.performAction }, ["issues"]),
  def("jira_get", "raw", false, "Generic low-level GET against Jira REST. Use for uncommon read endpoints.", { apiName: { type: "string", default: "api" }, apiVersion: { type: "string" }, path: { type: "string" }, query: { type: "object" } }, ["path"]),
  def("jira_request", "raw", true, "Generic low-level mutating request against Jira REST. Requires performAction:true.", { method: { type: "string" }, apiName: { type: "string", default: "api" }, apiVersion: { type: "string" }, path: { type: "string" }, query: { type: "object" }, body: { type: "object" }, performAction: p.performAction }, ["method", "path"]),
];

const TOOL_ALIASES = new Map([
  ["me", "jira_get_current_user"],
  ["users.me", "jira_get_current_user"],
  ["users.search", "jira_search_users"],
  ["users.assignable", "jira_search_assignable_users"],
  ["users.board", "jira_get_board_users"],
  ["board.users", "jira_get_board_users"],
  ["server.info", "jira_get_server_info"],
  ["fields.list", "jira_get_fields"],
  ["priorities.list", "jira_get_priorities"],
  ["statuses.list", "jira_get_statuses"],
  ["issuetypes.list", "jira_get_issue_types"],
  ["createmeta", "jira_get_create_meta"],
  ["editmeta", "jira_get_edit_meta"],
  ["get_issue", "jira_get_issue"],
  ["issue.get", "jira_get_issue"],
  ["issue.assign", "jira_assign_issue"],
  ["issue.labels", "jira_update_labels"],
  ["search", "jira_search"],
  ["issues.search", "jira_search"],
  ["projects.list", "jira_list_projects"],
  ["project.get", "jira_get_project"],
  ["comments.list", "jira_get_comments"],
  ["comments.add", "jira_add_comment"],
  ["comments.update", "jira_update_comment"],
  ["comments.delete", "jira_delete_comment"],
  ["comments.add_with_attachments", "jira_comment_with_attachments"],
  ["comments.add.with.attachments", "jira_comment_with_attachments"],
  ["comments.add-with-attachments", "jira_comment_with_attachments"],
  ["comment.attach", "jira_comment_with_attachments"],
  ["easy.comment", "jira_comment_with_attachments"],
  ["transitions.list", "jira_get_transitions"],
  ["transitions.apply", "jira_transition_issue"],
  ["transitions.apply_by_name", "jira_transition_issue_by_name"],
  ["transitions.apply-by-name", "jira_transition_issue_by_name"],
  ["transitions.apply.by.name", "jira_transition_issue_by_name"],
  ["move", "jira_transition_issue_by_name"],
  ["attachments.list", "jira_list_attachments"],
  ["attachments.add", "jira_add_attachment"],
  ["attachment.add", "jira_add_attachment"],
  ["attachments.get", "jira_get_attachment"],
  ["votes.list", "jira_get_voters"],
  ["votes.add", "jira_add_vote"],
  ["votes.remove", "jira_remove_vote"],
  ["watchers.list", "jira_get_watchers"],
  ["watchers.add", "jira_add_watcher"],
  ["watchers.remove", "jira_remove_watcher"],
  ["worklogs.list", "jira_get_worklogs"],
  ["worklogs.add", "jira_add_worklog"],
  ["worklogs.update", "jira_update_worklog"],
  ["worklogs.delete", "jira_delete_worklog"],
  ["links.types", "jira_get_issue_link_types"],
  ["links.get", "jira_get_issue_link"],
  ["links.add", "jira_link_issues"],
  ["links.delete", "jira_delete_issue_link"],
  ["remotelinks.list", "jira_get_remote_links"],
  ["remotelinks.get", "jira_get_remote_link"],
  ["remotelinks.add", "jira_upsert_remote_link"],
  ["remotelinks.update", "jira_update_remote_link"],
  ["remotelinks.delete", "jira_delete_remote_link"],
  ["boards.list", "jira_list_boards"],
  ["boards.get", "jira_get_board"],
  ["boards.issues", "jira_get_board_issues"],
  ["boards.backlog", "jira_get_backlog_issues"],
  ["sprints.list", "jira_get_sprints"],
  ["sprints.issues", "jira_get_sprint_issues"],
  ["sprints.move", "jira_move_issues_to_sprint"],
  ["backlog.move", "jira_move_issues_to_backlog"],
  ["get", "jira_get"],
  ["request", "jira_request"],
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
      return userSummary(await client.getCurrentUser());
    }
    case "jira_get_user": {
      return userSummary(await client.getUser(requireArg(args, "username")));
    }
    case "jira_search_users": {
      const users = await client.searchUsers(args);
      return { total: users.length, users: users.map(userSummary) };
    }
    case "jira_search_assignable_users": {
      const users = await client.searchAssignableUsers(args);
      return { total: users.length, users: users.map(userSummary) };
    }
    case "jira_get_board_users":
      return getBoardUsers(client, args, options);
    case "jira_get_server_info":
      return client.getServerInfo();
    case "jira_get_fields": {
      const fields = await client.getFields();
      return { total: fields.length, fields: fields.map((field) => ({ id: field.id, name: field.name, custom: field.custom, orderable: field.orderable, navigable: field.navigable, searchable: field.searchable })) };
    }
    case "jira_get_priorities": {
      const priorities = await client.getPriorities();
      return { total: priorities.length, priorities: priorities.map((item) => ({ id: item.id, name: item.name, description: item.description, iconUrl: item.iconUrl })) };
    }
    case "jira_get_statuses": {
      const statuses = await client.getStatuses();
      return { total: statuses.length, statuses: statuses.map((item) => ({ id: item.id, name: item.name, description: item.description, category: item.statusCategory?.name ?? null })) };
    }
    case "jira_get_issue_types": {
      const issueTypes = await client.getIssueTypes();
      return { total: issueTypes.length, issueTypes: issueTypes.map((item) => ({ id: item.id, name: item.name, description: item.description, subtask: item.subtask })) };
    }
    case "jira_get_create_meta":
      return client.getCreateMeta(args);
    case "jira_get_edit_meta":
      return client.getEditMeta(requireArg(args, "issueKey"));
    case "jira_list_projects": {
      const projects = await client.getProjects();
      return { total: projects.length, projects: projects.map((item) => ({ key: item.key, name: item.name ?? null, id: item.id, projectType: item.projectTypeKey, lead: item.lead?.displayName ?? null })) };
    }
    case "jira_get_project": {
      const item = await client.getProject(requireArg(args, "projectKey"));
      return { key: item.key, name: item.name ?? null, id: item.id, description: item.description, projectType: item.projectTypeKey, lead: item.lead?.displayName ?? null };
    }
    case "jira_search": {
      const result = await client.search(requireArg(args, "jql"), Number(args.maxResults || 50), Number(args.startAt || 0), args.fields);
      return { total: result.total, startAt: result.startAt, maxResults: result.maxResults, issues: result.issues.map(issueSummary) };
    }
    case "jira_get_issue":
      return issueSummary(await client.getIssue(requireArg(args, "issueKey"), args.fields, args.expand));
    case "jira_create_issue": {
      const fields = args.fields ? { ...args.fields } : {};
      if (args.projectKey) fields.project = { key: args.projectKey };
      if (args.summary) fields.summary = args.summary;
      if (args.issueType || !fields.issuetype) fields.issuetype = { name: args.issueType || "Task" };
      if (!fields.project || !fields.summary || !fields.issuetype) {
        throw new Error("projectKey, summary, and issueType (or equivalent fields) are required");
      }
      Object.assign(fields, pickIssueFields({
        description: args.description,
        assignee: args.assignee ? { name: args.assignee } : undefined,
        priority: args.priority ? { name: args.priority } : undefined,
        labels: args.labels,
      }));
      const result = await client.createIssue(fields);
      return { success: true, key: result.key, id: result.id, self: result.self };
    }
    case "jira_update_issue": {
      const fields = args.fields ? { ...args.fields } : pickIssueFields({
        summary: args.summary,
        description: args.description,
        assignee: args.assignee === null ? null : args.assignee ? { name: args.assignee } : undefined,
        priority: args.priority ? { name: args.priority } : undefined,
        labels: args.labels,
      });
      await client.editIssue(requireArg(args, "issueKey"), pickIssueFields({ fields, update: args.update }), { notifyUsers: args.notifyUsers });
      return { success: true, message: `Issue ${args.issueKey} updated successfully` };
    }
    case "jira_assign_issue": {
      const username = await resolveAssignableUsername(client, args, options);
      await client.assignIssue(requireArg(args, "issueKey"), username);
      return { success: true, issueKey: args.issueKey, assignee: username };
    }
    case "jira_update_labels": {
      const issueKey = requireArg(args, "issueKey");
      if (args.set) {
        await client.editIssue(issueKey, { fields: { labels: args.set } });
        return { success: true, issueKey, labels: { set: args.set } };
      }
      const operations = [
        ...toArray(args.add).map((label) => ({ add: label })),
        ...toArray(args.remove).map((label) => ({ remove: label })),
      ];
      if (operations.length === 0) {
        throw new Error("Provide add, remove, or set labels");
      }
      await client.editIssue(issueKey, { update: { labels: operations } });
      return { success: true, issueKey, labels: { operations } };
    }
    case "jira_delete_issue":
      await client.deleteIssue(requireArg(args, "issueKey"), !!args.deleteSubtasks);
      return { success: true, message: `Issue ${args.issueKey} deleted successfully` };
    case "jira_get_comments": {
      const result = await client.getComments(requireArg(args, "issueKey"));
      return { total: result.total, comments: result.comments.map((item) => ({ id: item.id, author: userSummary(item.author), body: item.body, created: item.created, updated: item.updated })) };
    }
    case "jira_add_comment": {
      const comment = await client.addComment(requireArg(args, "issueKey"), requireArg(args, "body"));
      return { success: true, commentId: comment.id, author: comment.author?.displayName ?? null, created: comment.created };
    }
    case "jira_update_comment": {
      const comment = await client.updateComment(requireArg(args, "issueKey"), requireArg(args, "commentId"), requireArg(args, "body"));
      return { success: true, commentId: comment.id, updated: comment.updated };
    }
    case "jira_delete_comment":
      await client.deleteComment(requireArg(args, "issueKey"), requireArg(args, "commentId"));
      return { success: true, issueKey: args.issueKey, commentId: args.commentId };
    case "jira_comment_with_attachments": {
      const issueKey = requireArg(args, "issueKey");
      const body = requireArg(args, "body");
      const attachments = await addAttachments(client, args);
      const comment = await client.addComment(issueKey, body);
      return { success: true, issueKey, comment: { id: comment.id, author: comment.author?.displayName ?? null, created: comment.created }, attachments: { total: attachments.length, files: attachments } };
    }
    case "jira_get_transitions": {
      const result = await client.getTransitions(requireArg(args, "issueKey"));
      return { issueKey: args.issueKey, transitions: result.transitions.map((item) => ({ id: item.id, name: item.name, toStatus: item.to?.name ?? null, toStatusCategory: item.to?.statusCategory?.name ?? null })) };
    }
    case "jira_transition_issue":
      await client.transitionIssue(requireArg(args, "issueKey"), requireArg(args, "transitionId"), args.comment, args.fields, args.update);
      return { success: true, message: `Issue ${args.issueKey} transitioned successfully` };
    case "jira_transition_issue_by_name":
      return transitionByName(client, args);
    case "jira_list_attachments": {
      const attachments = await client.listAttachments(requireArg(args, "issueKey"));
      return { issueKey: args.issueKey, total: attachments.length, attachments: attachments.map(cleanAttachment) };
    }
    case "jira_add_attachment": {
      const attachments = await addAttachments(client, args, { required: true });
      return { success: true, issueKey: args.issueKey, total: attachments.length, attachments };
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
      return { id: meta.id, filename: meta.filename, mimeType, size: meta.size, bytes: buffer.byteLength, created: meta.created, author: meta.author?.displayName ?? null, savedPath, base64: args.inlineBase64 === true ? buffer.toString("base64") : undefined };
    }
    case "jira_get_voters": {
      const result = await client.getVoters(requireArg(args, "issueKey"));
      return { votes: result.votes ?? 0, hasVoted: result.hasVoted ?? null, voters: (result.voters || []).map(userSummary) };
    }
    case "jira_add_vote":
      await client.addVote(requireArg(args, "issueKey"));
      return { success: true, issueKey: args.issueKey, voted: true };
    case "jira_remove_vote":
      await client.removeVote(requireArg(args, "issueKey"));
      return { success: true, issueKey: args.issueKey, voted: false };
    case "jira_get_watchers": {
      const result = await client.getWatchers(requireArg(args, "issueKey"));
      return { isWatching: result.isWatching ?? null, watchCount: result.watchCount ?? 0, watchers: (result.watchers || []).map(userSummary) };
    }
    case "jira_add_watcher": {
      const username = await resolveUsername(client, requireArg(args, "username"));
      await client.addWatcher(requireArg(args, "issueKey"), username);
      return { success: true, issueKey: args.issueKey, watcher: username };
    }
    case "jira_remove_watcher": {
      const username = await resolveUsername(client, requireArg(args, "username"));
      await client.removeWatcher(requireArg(args, "issueKey"), username);
      return { success: true, issueKey: args.issueKey, removedWatcher: username };
    }
    case "jira_get_worklogs": {
      const result = await client.getWorklogs(requireArg(args, "issueKey"));
      return { total: result.total, startAt: result.startAt, maxResults: result.maxResults, worklogs: (result.worklogs || []).map(cleanWorklog) };
    }
    case "jira_add_worklog": {
      const result = await client.addWorklog(requireArg(args, "issueKey"), worklogPayload(args), args);
      return { success: true, worklog: cleanWorklog(result) };
    }
    case "jira_update_worklog": {
      const result = await client.updateWorklog(requireArg(args, "issueKey"), requireArg(args, "worklogId"), worklogPayload(args), args);
      return { success: true, worklog: cleanWorklog(result) };
    }
    case "jira_delete_worklog":
      await client.deleteWorklog(requireArg(args, "issueKey"), requireArg(args, "worklogId"), args);
      return { success: true, issueKey: args.issueKey, worklogId: args.worklogId };
    case "jira_get_issue_link_types": {
      const result = await client.getIssueLinkTypes();
      return { issueLinkTypes: result.issueLinkTypes || [] };
    }
    case "jira_get_issue_link":
      return client.getIssueLink(requireArg(args, "linkId"));
    case "jira_link_issues": {
      await client.linkIssues({ type: { name: requireArg(args, "linkType") }, inwardIssue: { key: requireArg(args, "inwardIssueKey") }, outwardIssue: { key: requireArg(args, "outwardIssueKey") }, comment: args.comment ? { body: args.comment } : undefined });
      return { success: true, inwardIssueKey: args.inwardIssueKey, outwardIssueKey: args.outwardIssueKey, linkType: args.linkType };
    }
    case "jira_delete_issue_link":
      await client.deleteIssueLink(requireArg(args, "linkId"));
      return { success: true, linkId: args.linkId };
    case "jira_get_remote_links":
      return client.getRemoteLinks(requireArg(args, "issueKey"), args.globalId);
    case "jira_get_remote_link":
      return client.getRemoteLink(requireArg(args, "issueKey"), requireArg(args, "linkId"));
    case "jira_upsert_remote_link":
      return client.upsertRemoteLink(requireArg(args, "issueKey"), remoteLinkPayload(args));
    case "jira_update_remote_link":
      return client.updateRemoteLink(requireArg(args, "issueKey"), requireArg(args, "linkId"), remoteLinkPayload(args));
    case "jira_delete_remote_link":
      if (args.linkId) {
        await client.deleteRemoteLink(requireArg(args, "issueKey"), args.linkId);
      } else {
        await client.deleteRemoteLinkByGlobalId(requireArg(args, "issueKey"), requireArg(args, "globalId"));
      }
      return { success: true, issueKey: args.issueKey, linkId: args.linkId, globalId: args.globalId };
    case "jira_list_boards":
      return client.getBoards(args);
    case "jira_get_board":
      return client.getBoard(requireArg(args, "boardId"));
    case "jira_get_board_issues":
      return client.getBoardIssues(requireArg(args, "boardId"), args);
    case "jira_get_backlog_issues":
      return client.getBacklogIssues(requireArg(args, "boardId"), args);
    case "jira_get_sprints":
      return client.getSprints(requireArg(args, "boardId"), args);
    case "jira_get_sprint_issues":
      return client.getSprintIssues(requireArg(args, "sprintId"), args);
    case "jira_move_issues_to_sprint":
      await client.moveIssuesToSprint(requireArg(args, "sprintId"), toArray(requireArg(args, "issues")));
      return { success: true, sprintId: args.sprintId, issues: toArray(args.issues) };
    case "jira_move_issues_to_backlog":
      await client.moveIssuesToBacklog(toArray(requireArg(args, "issues")));
      return { success: true, issues: toArray(args.issues) };
    case "jira_get":
      return client.rawGet({ path: requireArg(args, "path"), apiName: args.apiName, apiVersion: args.apiVersion, query: args.query });
    case "jira_request": {
      const method = String(requireArg(args, "method")).toUpperCase();
      if (method === "GET") {
        throw new Error("Use jira_get for GET requests so read operations do not require mutation approval");
      }
      return client.rawRequest({ method, path: requireArg(args, "path"), apiName: args.apiName, apiVersion: args.apiVersion, query: args.query, body: args.body });
    }
    default:
      throw new Error(`Unhandled Jira tool: ${tool}`);
  }
}
