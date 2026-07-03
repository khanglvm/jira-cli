# @khanglvm/jira-cli

Direct, profile-aware CLI for legacy Jira Server 7.x REST API v2. It ports the useful `@khanglvm/jira-mcp` tool surface into a short-lived CLI process so agents can call Jira without starting an MCP server.

## Install

```bash
npm install -g @khanglvm/jira-cli
```

## Configure

Import the existing Claude Code MCP credentials:

```bash
jira-cli profile import-claude --default
jira-cli profile test
```

Or add a profile manually:

```bash
jira-cli profile add work \
  --base-url https://jira.example.com \
  --username "$JIRA_USERNAME" \
  --password "$JIRA_PASSWORD" \
  --default
```

Credentials are stored in the OS keychain by default. Set `JIRA_CLI_KEYCHAIN_MODE=optional` to fall back to inline config if keychain access is unavailable, or `disabled` to store inline.

## Use

```bash
jira-cli invoke jira_get_current_user
jira-cli invoke jira_search --args '{"jql":"assignee = currentUser() AND resolution IS EMPTY","maxResults":10}'
jira-cli invoke jira_get_issue --args '{"issueKey":"PROJ-123"}'
jira-cli batch --ops '[{"tool":"me"},{"tool":"search","args":{"jql":"updated >= -1d","maxResults":5}}]'
```

Mutations are dry-run by default:

```bash
jira-cli invoke jira_add_comment --args '{"issueKey":"PROJ-123","body":"Investigating."}'
```

Execute a mutation only with an explicit action flag:

```bash
jira-cli invoke jira_add_comment \
  --perform-action \
  --args '{"issueKey":"PROJ-123","body":"Investigating.","performAction":true}'
```

## Profiles

Profiles let one machine hold multiple Jira workspaces/accounts:

```bash
jira-cli profile list
jira-cli profile use work
jira-cli --profile work invoke jira_list_projects
```

Config defaults to `~/.config/jira-cli/config.json`. Override with `JIRA_CLI_CONFIG` or `--config`.

## Tools

Run `jira-cli tools list` for JSON contracts.

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

Attachment downloads save bytes to a local temp path by default. Pass
`"inlineBase64": true` only when an agent explicitly needs the bytes inline.

## JQL Notes

Use `statusCategory` for broad workflow buckets (`"To Do"`, `"In Progress"`, `"Done"`). Do not write `type = "To Do"`; `type`/`issuetype` is for `Bug`, `Task`, `Story`, `Epic`, and instance-specific issue types.

Status changes must use workflow transitions. Call `jira_get_transitions` first, then call `jira_transition_issue` with the returned transition id.
