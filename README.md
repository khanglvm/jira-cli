# @khanglvm/jira-cli

Direct, profile-aware CLI for legacy Jira Server 7.x REST API v2. It ports the useful `@khanglvm/jira-mcp` tool surface into a short-lived CLI process so agents can call Jira without starting an MCP server.

## Install

```bash
npm install -g @khanglvm/jira-cli
```

## Configure

Add a profile:

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

Quick agent shortcuts cover the common cases without hand-writing JSON:

```bash
jira-cli easy
jira-cli mine --max-results 20
jira-cli search --mine --open --max-results 20
jira-cli search --reported --order-by "priority DESC"
jira-cli show PROJ-123
jira-cli create PROJ "Fix login edge case" --issue-type Bug --description "Steps..." --perform-action
jira-cli assign PROJ-123 me --perform-action
jira-cli users --board 130 --query khang
jira-cli ticket assign PROJ-123 "Khang Le" --board 130 --resolve-only
jira-cli ticket assign PROJ-123 "Khang Le" --board 130 --perform-action
jira-cli move PROJ-123 "Done" --comment "Fixed." --perform-action
jira-cli label PROJ-123 --add agent-reviewed --perform-action
jira-cli comment PROJ-123 --body "Investigating." --perform-action
jira-cli comment PROJ-123 --body "Done." --attach screenshot.png --attach notes.txt --perform-action
jira-cli worklog PROJ-123 30m --comment "Investigated logs" --perform-action
jira-cli link PROJ-123 PROJ-456 --type Blocks --perform-action
jira-cli remote-link PROJ-123 "https://ci.example/build/1" "CI build" --perform-action
jira-cli watch PROJ-123 --perform-action
jira-cli vote PROJ-123 --perform-action
jira-cli attach PROJ-123 screenshot.png notes.txt --perform-action
jira-cli boards --project PROJ
jira-cli sprints 42 --state active
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

For a single agent tool call that comments and uploads attachments:

```bash
jira-cli invoke comments.add-with-attachments \
  --perform-action \
  --args '{"issueKey":"PROJ-123","body":"Done.","attachments":["screenshot.png","notes.txt"],"performAction":true}'
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

- Users/profile: `jira_get_current_user`, `jira_get_user`, `jira_search_users`, `jira_search_assignable_users`
- Board users: `jira_get_board_users` lists assignable board/project users and caches results for 30 days by default
- Metadata: `jira_get_server_info`, `jira_get_fields`, `jira_get_priorities`, `jira_get_statuses`, `jira_get_issue_types`, `jira_get_create_meta`, `jira_get_edit_meta`
- Projects/issues: `jira_list_projects`, `jira_get_project`, `jira_search`, `jira_get_issue`, `jira_create_issue`, `jira_update_issue`, `jira_assign_issue`, `jira_update_labels`, `jira_delete_issue`
- Comments/transitions/attachments: `jira_get_comments`, `jira_add_comment`, `jira_update_comment`, `jira_delete_comment`, `jira_comment_with_attachments`, `jira_get_transitions`, `jira_transition_issue`, `jira_transition_issue_by_name`, `jira_list_attachments`, `jira_add_attachment`, `jira_get_attachment`
- Collaboration/time: `jira_get_voters`, `jira_add_vote`, `jira_remove_vote`, `jira_get_watchers`, `jira_add_watcher`, `jira_remove_watcher`, `jira_get_worklogs`, `jira_add_worklog`, `jira_update_worklog`, `jira_delete_worklog`
- Links: `jira_get_issue_link_types`, `jira_get_issue_link`, `jira_link_issues`, `jira_delete_issue_link`, `jira_get_remote_links`, `jira_get_remote_link`, `jira_upsert_remote_link`, `jira_update_remote_link`, `jira_delete_remote_link`
- Jira Agile: `jira_list_boards`, `jira_get_board`, `jira_get_board_issues`, `jira_get_backlog_issues`, `jira_get_sprints`, `jira_get_sprint_issues`, `jira_move_issues_to_sprint`, `jira_move_issues_to_backlog`
- Escape hatches: `jira_get` for uncommon GET endpoints, `jira_request` for uncommon mutating endpoints

Attachment uploads use Jira's `/attachments` endpoint and require
`--perform-action` plus `"performAction": true`, like other mutations.
Attachment downloads save bytes to a local temp path by default. Pass
`"inlineBase64": true` only when an agent explicitly needs the bytes inline.

Use `jira_get` for low-level reads:

```bash
jira-cli invoke jira_get --args '{"path":"/serverInfo"}'
jira-cli invoke jira_get --args '{"apiName":"agile","apiVersion":"1.0","path":"/board","query":{"maxResults":5}}'
```

Use `jira_request` only for endpoints that do not have a named tool yet:

```bash
jira-cli invoke jira_request \
  --perform-action \
  --args '{"method":"POST","path":"/issue/PROJ-123/votes","performAction":true}'
```

## Cached Users and Assignment

`jira-cli users --board <id>` samples board issues to discover project keys, loads assignable users for those projects, and stores the result under `~/.cache/jira-cli` for 30 days by default. `jira-cli users --issue <key>` and plain `jira-cli assign <key> "Display Name"` use the issue assignable-user list by default. Use `--refresh-cache`, `--no-cache`, `--cache-dir`, or `--cache-ttl-days` when needed.

```bash
jira-cli users --board 130 --query khang
jira-cli assign PROJ-123 "Khang Le" --resolve-only
jira-cli ticket assign PROJ-123 "Khang Le" --board 130 --perform-action
```

The assign commands accept username, display name, or email. Add `--board` or
`--project` when you want a reusable cached board/project list for inline
resolution. `--resolve-only` verifies the cached match without changing the
issue.

## JQL Notes

Use `statusCategory` for broad workflow buckets (`"To Do"`, `"In Progress"`, `"Done"`). Do not write `type = "To Do"`; `type`/`issuetype` is for `Bug`, `Task`, `Story`, `Epic`, and instance-specific issue types.

Status changes must use workflow transitions. Call `jira_get_transitions` first, then call `jira_transition_issue` with the returned transition id.
