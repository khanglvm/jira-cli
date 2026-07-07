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

If no profile exists, configure one with `jira-cli profile add <id> --base-url ... --username ... --password ... --default`.

## Command Policy

- Prefer quick commands for daily flows: `mine`, `search`, `show`, `create`,
  `assign`, `move`, `label`, `comment`, `attach`, `worklog`, `link`,
  `remote-link`, `watch`, `vote`, `boards`, `sprints`.
- Use `jira-cli invoke <tool> --args '<json>'` when a low-level named tool is
  clearer or when composing batch reads.
- Use `jira_get` for uncommon read endpoints and `jira_request` for uncommon
  mutating endpoints only when no named tool fits.
- Use `jira-cli batch --ops '<json-array>'` for independent reads.
- Use `--profile <id>` when multiple Jira accounts/workspaces exist.
- Use `--args-file` for long comments, descriptions, or batch payloads.
- Do not execute mutating calls unless the user clearly requested the mutation.

## Quick Commands

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
jira-cli comment PROJ-123 --body "Done." --perform-action
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

## Tools

Run `jira-cli tools list` for full JSON contracts.

- Users/profile: `jira_get_current_user`, `jira_get_user`, `jira_search_users`,
  `jira_search_assignable_users`, `jira_get_board_users`.
- Metadata: `jira_get_server_info`, `jira_get_fields`, `jira_get_priorities`,
  `jira_get_statuses`, `jira_get_issue_types`, `jira_get_create_meta`,
  `jira_get_edit_meta`.
- Projects/issues: `jira_list_projects`, `jira_get_project`, `jira_search`,
  `jira_get_issue`, `jira_create_issue`, `jira_update_issue`,
  `jira_assign_issue`, `jira_update_labels`, `jira_delete_issue`.
- Comments/transitions/attachments: `jira_get_comments`, `jira_add_comment`,
  `jira_update_comment`, `jira_delete_comment`,
  `jira_comment_with_attachments`, `jira_get_transitions`,
  `jira_transition_issue`, `jira_transition_issue_by_name`,
  `jira_list_attachments`, `jira_add_attachment`, `jira_get_attachment`.
- Collaboration/time: `jira_get_voters`, `jira_add_vote`, `jira_remove_vote`,
  `jira_get_watchers`, `jira_add_watcher`, `jira_remove_watcher`,
  `jira_get_worklogs`, `jira_add_worklog`, `jira_update_worklog`,
  `jira_delete_worklog`.
- Links/Agile/raw: issue links, remote links, boards, sprints, backlog/sprint
  moves, plus `jira_get` and `jira_request`.

`jira_get_board_users` and `jira-cli users --board <id>` cache assignable board
users for 30 days by default under `~/.cache/jira-cli`. `jira-cli users --issue
<key>` and `jira-cli ticket assign PROJ-123 "Display Name"` use the issue
assignable-user list by default. Use `--refresh-cache`, `--no-cache`,
`--cache-dir`, or `--cache-ttl-days` when needed. Use `jira-cli ticket assign
PROJ-123 "Display Name" --resolve-only` to verify the cached match without
changing the issue; add `--board` or `--project` for reusable board/project
resolution.

For a single agent tool call that comments and uploads local files:

```bash
jira-cli invoke comments.add-with-attachments \
  --perform-action \
  --args '{"issueKey":"PROJ-123","body":"Done.","attachments":["screenshot.png","notes.txt"],"performAction":true}'
```

Attachment uploads require `--perform-action` plus `performAction:true`, like
other mutations.
Attachment downloads return `savedPath` by default. Request
`inlineBase64:true` only when the inline bytes are truly needed.

Aliases include `me`, `search`, `get_issue`, `projects.list`, `comments.add`,
`comments.add-with-attachments`, `attachments.add`, `transitions.list`,
`transitions.apply-by-name`, `worklogs.add`, `links.add`, `boards.list`,
`sprints.list`, `get`, and `request`.

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
4. Batch independent reads:
   ```bash
   jira-cli batch --ops '[{"tool":"me"},{"tool":"projects.list"},{"tool":"fields.list"}]'
   ```

## Mutation Workflow

Mutations dry-run by default. A mutation executes only when both the CLI flag and
tool args include explicit intent:

```bash
jira-cli invoke comments.add \
  --perform-action \
  --args '{"issueKey":"PROJ-123","body":"Done.","performAction":true}'
```

For comments with attachments, prefer the quick command or combined tool:

```bash
jira-cli comment PROJ-123 --body "Done." --attach screenshot.png --perform-action
```

For status changes, prefer transition-by-name for daily use:

```bash
jira-cli move PROJ-123 "Done" --comment "Fixed." --perform-action
```

When exact workflow control matters:

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

For raw endpoints:

```bash
jira-cli invoke jira_get --args '{"path":"/serverInfo"}'
jira-cli invoke jira_request --perform-action --args '{"method":"POST","path":"/issue/PROJ-123/votes","performAction":true}'
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
