---
name: jira-cli
description: >
  Use the local `jira-cli` direct Jira CLI for self-hosted Jira Server 7.x
  work-item workflows. Activate when the user mentions Jira, tickets, issues,
  bugs, tasks, stories, epics, JQL, issue transitions, project management,
  standup prep, sprint overview, bug triage, "my tickets", "assigned to me",
  "todo tickets", "move ticket to done", "create a bug", or weekly Jira
  reporting. This skill replaces MCP startup with short-lived CLI calls.
---

# Jira CLI

Use `jira-cli` instead of starting a Jira MCP server.

## Bootstrap

Check setup only when needed:

```bash
jira-cli --version
jira-cli profile list
jira-cli profile test
```

If no profile exists, import the saved Claude Code MCP credentials:

```bash
jira-cli profile import-claude --default
jira-cli profile test
```

## Command Policy

- Prefer `jira-cli invoke <tool> --args '<json>'`.
- Use `jira-cli batch --ops '<json-array>'` for independent reads.
- Use `--profile <id>` when multiple Jira accounts/workspaces exist.
- Use `--args-file` for long comments, descriptions, or batch payloads.
- Do not execute mutating calls unless the user clearly requested the mutation.

## Tools

- `jira_get_current_user`
- `jira_get_user`
- `jira_list_projects`
- `jira_get_project`
- `jira_search`
- `jira_get_issue`
- `jira_create_issue`
- `jira_update_issue`
- `jira_delete_issue`
- `jira_get_comments`
- `jira_add_comment`
- `jira_get_transitions`
- `jira_transition_issue`
- `jira_list_attachments`
- `jira_get_attachment`

Attachment downloads return `savedPath` by default. Request
`inlineBase64:true` only when the inline bytes are truly needed.

Aliases include `me`, `search`, `get_issue`, `projects.list`, `comments.add`,
`transitions.list`, and `attachments.get`.

## Read Workflow

1. Verify identity when auth or account selection matters:
   ```bash
   jira-cli invoke me
   ```
2. Search with compact fields first:
   ```bash
   jira-cli invoke search --args '{"jql":"assignee = currentUser() AND resolution IS EMPTY ORDER BY priority DESC","maxResults":20}'
   ```
3. Hydrate only selected issues:
   ```bash
   jira-cli invoke jira_get_issue --args '{"issueKey":"PROJ-123"}'
   ```

## Mutation Workflow

Mutations dry-run by default. A mutation executes only when both the CLI flag and
tool args include explicit intent:

```bash
jira-cli invoke comments.add \
  --perform-action \
  --args '{"issueKey":"PROJ-123","body":"Done.","performAction":true}'
```

For status changes:

1. List transitions:
   ```bash
   jira-cli invoke transitions.list --args '{"issueKey":"PROJ-123"}'
   ```
2. Apply the selected transition id:
   ```bash
   jira-cli invoke jira_transition_issue \
     --perform-action \
     --args '{"issueKey":"PROJ-123","transitionId":"31","performAction":true}'
   ```

## JQL Guardrails

- `statusCategory` has only `"To Do"`, `"In Progress"`, and `"Done"`.
- `type` / `issuetype` is for issue types such as `Bug`, `Task`, `Story`, `Epic`.
- Never use `type = "To Do"`.
- Quote values with spaces.
- Use `ORDER BY updated DESC` or `ORDER BY priority DESC` when ranking matters.

## Output

Results are JSON. Large payloads may be offloaded to temp files. Inspect them
with:

```bash
jira-cli tmp cat /path/from/result.json
```
