import { JiraApiError } from "./errors.js";

function apiBaseUrl(profile) {
  return `${profile.baseUrl.replace(/\/$/, "")}/rest/api/${profile.apiVersion || "2"}`;
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
    const baseUrl = options.authEndpoint ? authBaseUrl(this.profile) : apiBaseUrl(this.profile);
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
      const response = await fetch(`${baseUrl}${path}`, {
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

  getUser(username) {
    return this.request("GET", `/user?username=${encodeURIComponent(username)}`);
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

  getTransitions(issueKey) {
    return this.request("GET", `/issue/${encodeURIComponent(issueKey)}/transitions`);
  }

  transitionIssue(issueKey, transitionId, comment) {
    const body = { transition: { id: transitionId } };
    if (comment) {
      body.update = { comment: [{ add: { body: comment } }] };
    }
    return this.request("POST", `/issue/${encodeURIComponent(issueKey)}/transitions`, body);
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
}
