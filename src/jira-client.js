import fs from "node:fs/promises";
import path from "node:path";
import { JiraApiError } from "./errors.js";

function apiBaseUrl(profile, apiName = "api", apiVersion) {
  return `${profile.baseUrl.replace(/\/$/, "")}/rest/${apiName}/${apiVersion || profile.apiVersion || "2"}`;
}

function authBaseUrl(profile) {
  return `${profile.baseUrl.replace(/\/$/, "")}/rest/auth/1`;
}

export class JiraClient {
  constructor(profile) {
    this.profile = profile;
    this.authHeader = `Basic ${Buffer.from(`${profile.auth.username}:${profile.auth.password}`).toString("base64")}`;
  }

  async request(method, path, body, options = {}) {
    const baseUrl = options.authEndpoint ? authBaseUrl(this.profile) : apiBaseUrl(this.profile, options.apiName, options.apiVersion);
    const query = options.query ? `?${new URLSearchParams(Object.entries(options.query).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString()}` : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(this.profile.timeoutMs || 30000));
    const headers = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    try {
      const response = await fetch(`${baseUrl}${path}${query}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 204 || response.headers.get("content-length") === "0") {
        return {};
      }
      const text = await response.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = text;
      }
      if (!response.ok) {
        let message = `Request failed with status ${response.status}`;
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.errorMessages) && parsed.errorMessages.length > 0) {
            message = String(parsed.errorMessages[0]);
          } else if (typeof parsed.message === "string") {
            message = parsed.message;
          }
        }
        throw new JiraApiError(message, response.status, parsed);
      }
      return parsed;
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new JiraApiError(`Request timeout after ${this.profile.timeoutMs || 30000}ms`, 408);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  getCurrentSession() {
    return this.request("GET", "/session", undefined, { authEndpoint: true });
  }

  getCurrentUser() {
    return this.request("GET", "/myself");
  }

  getServerInfo() {
    return this.request("GET", "/serverInfo");
  }

  getUser(username) {
    return this.request("GET", `/user?username=${encodeURIComponent(username)}`);
  }

  searchUsers({ username, query, startAt, maxResults, includeActive, includeInactive } = {}) {
    return this.request("GET", "/user/search", undefined, {
      query: {
        username: username || query,
        startAt,
        maxResults,
        includeActive,
        includeInactive,
      },
    });
  }

  searchAssignableUsers({ username, query, projectKey, issueKey, startAt, maxResults, actionDescriptorId } = {}) {
    return this.request("GET", "/user/assignable/search", undefined, {
      query: {
        username: username || query,
        project: projectKey,
        issueKey,
        startAt,
        maxResults,
        actionDescriptorId,
      },
    });
  }

  getIssue(issueKey, fields, expand) {
    const params = new URLSearchParams();
    if (fields) params.set("fields", fields);
    if (expand) params.set("expand", expand);
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}${query}`);
  }

  createIssue(fields) {
    return this.request("POST", "/issue", { fields });
  }

  updateIssue(issueKey, fields) {
    return this.request("PUT", `/issue/${encodeURIComponent(issueKey)}`, { fields });
  }

  editIssue(issueKey, payload, options = {}) {
    return this.request("PUT", `/issue/${encodeURIComponent(issueKey)}`, payload, {
      query: { notifyUsers: options.notifyUsers },
    });
  }

  deleteIssue(issueKey, deleteSubtasks = false) {
    const query = deleteSubtasks ? "?deleteSubtasks=true" : "";
    return this.request("DELETE", `/issue/${encodeURIComponent(issueKey)}${query}`);
  }

  getComments(issueKey) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/comment`);
  }

  addComment(issueKey, body) {
    return this.request("POST", `/issue/${encodeURIComponent(issueKey)}/comment`, { body });
  }

  updateComment(issueKey, commentId, body) {
    return this.request("PUT", `/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`, { body });
  }

  deleteComment(issueKey, commentId) {
    return this.request("DELETE", `/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`);
  }

  assignIssue(issueKey, username) {
    return this.request("PUT", `/issue/${encodeURIComponent(issueKey)}/assignee`, { name: username });
  }

  getTransitions(issueKey) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/transitions`);
  }

  transitionIssue(issueKey, transitionId, comment, fields, update) {
    const body = { transition: { id: transitionId } };
    if (comment) {
      body.update = { comment: [{ add: { body: comment } }] };
    }
    if (fields) {
      body.fields = fields;
    }
    if (update) {
      body.update = { ...(body.update || {}), ...update };
    }
    return this.request("POST", `/issue/${encodeURIComponent(issueKey)}/transitions`, body);
  }

  getEditMeta(issueKey) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/editmeta`);
  }

  search(jql, maxResults = 50, startAt = 0, fields) {
    return this.request("POST", "/search", {
      jql,
      maxResults,
      startAt,
      fields: fields || ["summary", "status", "assignee", "priority", "issuetype"],
    });
  }

  getProjects() {
    return this.request("GET", "/project");
  }

  getProject(projectKey) {
    return this.request("GET", `/project/${encodeURIComponent(projectKey)}`);
  }

  getFields() {
    return this.request("GET", "/field");
  }

  getPriorities() {
    return this.request("GET", "/priority");
  }

  getStatuses() {
    return this.request("GET", "/status");
  }

  getIssueTypes() {
    return this.request("GET", "/issuetype");
  }

  getCreateMeta({ projectKeys, projectIds, issueTypeIds, issueTypeNames, expand } = {}) {
    return this.request("GET", "/issue/createmeta", undefined, {
      query: { projectKeys, projectIds, issuetypeIds: issueTypeIds, issuetypeNames: issueTypeNames, expand },
    });
  }

  async listAttachments(issueKey) {
    const issue = await this.getIssue(issueKey, "attachment");
    const attachments = issue?.fields?.attachment;
    return Array.isArray(attachments) ? attachments : [];
  }

  getAttachmentMeta(attachmentId) {
    return this.request("GET", `/attachment/${encodeURIComponent(attachmentId)}`);
  }

  async downloadAttachment(contentUrl) {
    const response = await fetch(contentUrl, {
      method: "GET",
      headers: { Authorization: this.authHeader },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new JiraApiError(`Failed to download attachment from ${contentUrl} (status ${response.status})`, response.status);
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "application/octet-stream",
    };
  }

  async uploadAttachment(issueKey, filePath, filename) {
    const buffer = await fs.readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([buffer]), filename || path.basename(filePath));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(this.profile.timeoutMs || 30000));
    try {
      const response = await fetch(`${apiBaseUrl(this.profile)}/issue/${encodeURIComponent(issueKey)}/attachments`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          "X-Atlassian-Token": "no-check",
        },
        body: form,
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = text;
      }
      if (!response.ok) {
        let message = `Attachment upload failed with status ${response.status}`;
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.errorMessages) && parsed.errorMessages.length > 0) {
            message = String(parsed.errorMessages[0]);
          } else if (typeof parsed.message === "string") {
            message = parsed.message;
          }
        }
        throw new JiraApiError(message, response.status, parsed);
      }
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new JiraApiError(`Request timeout after ${this.profile.timeoutMs || 30000}ms`, 408);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  getVoters(issueKey) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/votes`);
  }

  addVote(issueKey) {
    return this.request("POST", `/issue/${encodeURIComponent(issueKey)}/votes`);
  }

  removeVote(issueKey) {
    return this.request("DELETE", `/issue/${encodeURIComponent(issueKey)}/votes`);
  }

  getWatchers(issueKey) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/watchers`);
  }

  addWatcher(issueKey, username) {
    return this.request("POST", `/issue/${encodeURIComponent(issueKey)}/watchers`, username);
  }

  removeWatcher(issueKey, username) {
    return this.request("DELETE", `/issue/${encodeURIComponent(issueKey)}/watchers`, undefined, {
      query: { username },
    });
  }

  getWorklogs(issueKey) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/worklog`);
  }

  addWorklog(issueKey, worklog, options = {}) {
    return this.request("POST", `/issue/${encodeURIComponent(issueKey)}/worklog`, worklog, {
      query: {
        adjustEstimate: options.adjustEstimate,
        newEstimate: options.newEstimate,
        reduceBy: options.reduceBy,
      },
    });
  }

  updateWorklog(issueKey, worklogId, worklog, options = {}) {
    return this.request("PUT", `/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}`, worklog, {
      query: {
        adjustEstimate: options.adjustEstimate,
        newEstimate: options.newEstimate,
      },
    });
  }

  deleteWorklog(issueKey, worklogId, options = {}) {
    return this.request("DELETE", `/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}`, undefined, {
      query: {
        adjustEstimate: options.adjustEstimate,
        newEstimate: options.newEstimate,
        increaseBy: options.increaseBy,
      },
    });
  }

  getIssueLinkTypes() {
    return this.request("GET", "/issueLinkType");
  }

  getIssueLink(linkId) {
    return this.request("GET", `/issueLink/${encodeURIComponent(linkId)}`);
  }

  linkIssues(payload) {
    return this.request("POST", "/issueLink", payload);
  }

  deleteIssueLink(linkId) {
    return this.request("DELETE", `/issueLink/${encodeURIComponent(linkId)}`);
  }

  getRemoteLinks(issueKey, globalId) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/remotelink`, undefined, {
      query: { globalId },
    });
  }

  getRemoteLink(issueKey, linkId) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/remotelink/${encodeURIComponent(linkId)}`);
  }

  upsertRemoteLink(issueKey, payload) {
    return this.request("POST", `/issue/${encodeURIComponent(issueKey)}/remotelink`, payload);
  }

  updateRemoteLink(issueKey, linkId, payload) {
    return this.request("PUT", `/issue/${encodeURIComponent(issueKey)}/remotelink/${encodeURIComponent(linkId)}`, payload);
  }

  deleteRemoteLink(issueKey, linkId) {
    return this.request("DELETE", `/issue/${encodeURIComponent(issueKey)}/remotelink/${encodeURIComponent(linkId)}`);
  }

  deleteRemoteLinkByGlobalId(issueKey, globalId) {
    return this.request("DELETE", `/issue/${encodeURIComponent(issueKey)}/remotelink`, undefined, {
      query: { globalId },
    });
  }

  agileRequest(method, path, body, query) {
    return this.request(method, path, body, { apiName: "agile", apiVersion: "1.0", query });
  }

  getBoards({ startAt, maxResults, type, name, projectKeyOrId } = {}) {
    return this.agileRequest("GET", "/board", undefined, { startAt, maxResults, type, name, projectKeyOrId });
  }

  getBoard(boardId) {
    return this.agileRequest("GET", `/board/${encodeURIComponent(boardId)}`);
  }

  getBoardIssues(boardId, { startAt, maxResults, jql, validateQuery, fields, expand } = {}) {
    return this.agileRequest("GET", `/board/${encodeURIComponent(boardId)}/issue`, undefined, { startAt, maxResults, jql, validateQuery, fields, expand });
  }

  getBacklogIssues(boardId, { startAt, maxResults, jql, validateQuery, fields, expand } = {}) {
    return this.agileRequest("GET", `/board/${encodeURIComponent(boardId)}/backlog`, undefined, { startAt, maxResults, jql, validateQuery, fields, expand });
  }

  getSprints(boardId, { startAt, maxResults, state } = {}) {
    return this.agileRequest("GET", `/board/${encodeURIComponent(boardId)}/sprint`, undefined, { startAt, maxResults, state });
  }

  getSprintIssues(sprintId, { startAt, maxResults, jql, validateQuery, fields, expand } = {}) {
    return this.agileRequest("GET", `/sprint/${encodeURIComponent(sprintId)}/issue`, undefined, { startAt, maxResults, jql, validateQuery, fields, expand });
  }

  moveIssuesToSprint(sprintId, issues) {
    return this.agileRequest("POST", `/sprint/${encodeURIComponent(sprintId)}/issue`, { issues });
  }

  moveIssuesToBacklog(issues) {
    return this.agileRequest("POST", "/backlog/issue", { issues });
  }

  rawGet({ apiName = "api", apiVersion, path, query } = {}) {
    return this.request("GET", path, undefined, { apiName, apiVersion, query });
  }

  rawRequest({ method, apiName = "api", apiVersion, path, query, body } = {}) {
    return this.request(method, path, body, { apiName, apiVersion, query });
  }
}
