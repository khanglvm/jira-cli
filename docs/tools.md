# Tool reference

Every Jira operation jira-cli can run is a named tool with a JSON input. This page lists all 62 tools and their arguments; the quick commands such as `show` and `move` call these tools for you.

## Call a tool

```sh
jira-cli invoke jira_get_issue --args '{"issueKey":"PROJ-123"}'
jira-cli invoke jira_search --args '{"jql":"assignee = currentUser() AND resolution IS EMPTY","maxResults":10}'
jira-cli invoke jira_add_comment --perform-action --args '{"issueKey":"PROJ-123","body":"Investigating.","performAction":true}'
```

`invoke <tool>` takes the arguments as JSON from `--args <json>`, `--args-file <path>` or `--stdin`. Use a file for long bodies.

A tool name can be written in full, without the `jira_` prefix (`get_issue`), or as a dotted alias such as `search`, `comments.add`, `transitions.apply-by-name`, `release.get`, `issue.assign` or `users.board`. `me` is an alias for `jira_get_current_user`. The result's `tool` field shows the full name that ran.

To run several independent tools in one process, use `batch`:

```sh
jira-cli batch --ops '[{"tool":"me"},{"tool":"search","args":{"jql":"updated >= -1d","maxResults":5}}]'
```

`batch` also reads `--ops-file <path>` or `--stdin`. Each entry in `results` has its own `ok`, and a failed tool does not stop the rest.

## Print the contracts

```sh
jira-cli tools list
jira-cli tools help jira_search
```

`tools list` prints every tool with its JSON input schema. `tools help <tool>` prints one. The list is long, so with the default result mode it lands in a temp file; add `--result-mode inline` to print it directly.

## Writes need two switches

A tool that writes (marked "yes" in the Writes column) does nothing unless both the `--perform-action` flag and `"performAction": true` in the arguments are present. With only one of them, it returns a dry run. In `batch`, a write runs only when `--perform-action` is set and that entry's `args` has `"performAction": true`. The quick commands set the argument for you when you pass the flag.

## Users

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_current_user` | no | none |
| `jira_get_user` | no | `username` (required) |
| `jira_search_users` | no | `username`, `query`, `startAt`, `maxResults`, `includeActive`, `includeInactive` |
| `jira_search_assignable_users` | no | `username`, `query`, `projectKey`, `issueKey`, `startAt`, `maxResults` |
| `jira_get_board_users` | no | `boardId`, `projectKey`, `projectKeys`, `issueKey`, `query`, `maxResults`, `issueSampleSize`, `refreshCache` |

## Metadata

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_server_info` | no | none |
| `jira_get_fields` | no | none |
| `jira_get_priorities` | no | none |
| `jira_get_statuses` | no | none |
| `jira_get_issue_types` | no | none |
| `jira_get_create_meta` | no | `projectKeys`, `projectIds`, `issueTypeIds`, `issueTypeNames`, `expand` |
| `jira_get_edit_meta` | no | `issueKey` (required) |

## Projects

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_list_projects` | no | none |
| `jira_get_project` | no | `projectKey` (required) |

## Releases

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_release_board` | no | `releaseBoard` (required) |

## Issues

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_search` | no | `jql` (required), `maxResults`, `startAt`, `fields` |
| `jira_get_issue` | no | `issueKey` (required), `fields`, `expand` |
| `jira_create_issue` | yes | `projectKey` (required), `summary` (required), `issueType`, `description`, `assignee`, `priority`, `labels`, `fields`, `update`, `performAction` |
| `jira_update_issue` | yes | `issueKey` (required), `summary`, `description`, `assignee`, `priority`, `labels`, `fields`, `update`, `notifyUsers`, `performAction` |
| `jira_assign_issue` | yes | `issueKey` (required), `username`, `person`, `boardId`, `projectKey`, `projectKeys`, `refreshCache`, `performAction` |
| `jira_update_labels` | yes | `issueKey` (required), `add`, `remove`, `set`, `performAction` |
| `jira_delete_issue` | yes | `issueKey` (required), `deleteSubtasks`, `performAction` |

## Comments

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_comments` | no | `issueKey` (required) |
| `jira_add_comment` | yes | `issueKey` (required), `body` (required), `performAction` |
| `jira_update_comment` | yes | `issueKey` (required), `commentId` (required), `body` (required), `performAction` |
| `jira_delete_comment` | yes | `issueKey` (required), `commentId` (required), `performAction` |

## Comment with files and transition by name

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_comment_with_attachments` | yes | `issueKey` (required), `body` (required), `attachments`, `filePath`, `filename`, `inlineImages`, `inlineImageMode`, `performAction` |
| `jira_transition_issue_by_name` | yes | `issueKey` (required), `transition` (required), `comment`, `fields`, `update`, `performAction` |

## Transitions

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_transitions` | no | `issueKey` (required) |
| `jira_transition_issue` | yes | `issueKey` (required), `transitionId` (required), `comment`, `fields`, `update`, `performAction` |

## Attachments

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_list_attachments` | no | `issueKey` (required) |
| `jira_add_attachment` | yes | `issueKey` (required), `filePath`, `filename`, `attachments`, `performAction` |
| `jira_get_attachment` | no | `attachmentId`, `issueKey`, `filename`, `inlineBase64` |

## Votes

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_voters` | no | `issueKey` (required) |
| `jira_add_vote` | yes | `issueKey` (required), `performAction` |
| `jira_remove_vote` | yes | `issueKey` (required), `performAction` |

## Watchers

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_watchers` | no | `issueKey` (required) |
| `jira_add_watcher` | yes | `issueKey` (required), `username` (required), `performAction` |
| `jira_remove_watcher` | yes | `issueKey` (required), `username` (required), `performAction` |

## Worklogs

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_worklogs` | no | `issueKey` (required) |
| `jira_add_worklog` | yes | `issueKey` (required), `timeSpent`, `timeSpentSeconds`, `comment`, `started`, `visibility`, `adjustEstimate`, `newEstimate`, `reduceBy`, `performAction` |
| `jira_update_worklog` | yes | `issueKey` (required), `worklogId` (required), `timeSpent`, `timeSpentSeconds`, `comment`, `started`, `visibility`, `adjustEstimate`, `newEstimate`, `performAction` |
| `jira_delete_worklog` | yes | `issueKey` (required), `worklogId` (required), `adjustEstimate`, `newEstimate`, `increaseBy`, `performAction` |

## Issue links

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_issue_link_types` | no | none |
| `jira_get_issue_link` | no | `linkId` (required) |
| `jira_link_issues` | yes | `inwardIssueKey` (required), `outwardIssueKey` (required), `linkType` (required), `comment`, `performAction` |
| `jira_delete_issue_link` | yes | `linkId` (required), `performAction` |

## Remote links

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get_remote_links` | no | `issueKey` (required), `globalId` |
| `jira_get_remote_link` | no | `issueKey` (required), `linkId` (required) |
| `jira_upsert_remote_link` | yes | `issueKey` (required), `url` (required), `title` (required), `globalId`, `relationship`, `summary`, `applicationType`, `applicationName`, `object`, `application`, `performAction` |
| `jira_update_remote_link` | yes | `issueKey` (required), `linkId` (required), `url` (required), `title` (required), `globalId`, `relationship`, `summary`, `object`, `application`, `performAction` |
| `jira_delete_remote_link` | yes | `issueKey` (required), `linkId`, `globalId`, `performAction` |

## Boards, sprints and backlog

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_list_boards` | no | `startAt`, `maxResults`, `type`, `name`, `projectKeyOrId` |
| `jira_get_board` | no | `boardId` (required) |
| `jira_get_board_issues` | no | `boardId` (required), `startAt`, `maxResults`, `jql`, `validateQuery`, `fields`, `expand` |
| `jira_get_backlog_issues` | no | `boardId` (required), `startAt`, `maxResults`, `jql`, `validateQuery`, `fields`, `expand` |
| `jira_get_sprints` | no | `boardId` (required), `startAt`, `maxResults`, `state` |
| `jira_get_sprint_issues` | no | `sprintId` (required), `startAt`, `maxResults`, `jql`, `validateQuery`, `fields`, `expand` |
| `jira_move_issues_to_sprint` | yes | `sprintId` (required), `issues` (required), `performAction` |
| `jira_move_issues_to_backlog` | yes | `issues` (required), `performAction` |

## Raw REST calls

| Tool | Writes | Arguments |
| --- | --- | --- |
| `jira_get` | no | `apiName`, `apiVersion`, `path` (required), `query` |
| `jira_request` | yes | `method` (required), `apiName`, `apiVersion`, `path` (required), `query`, `body`, `performAction` |

Argument shapes beyond these names come from the tool's JSON schema in `jira-cli tools help <tool>`. Two details worth knowing:

- `jira_comment_with_attachments` takes `attachments` (file paths, or objects with `path` and `filename`) and `inlineImages` (paths, or objects with `path`, `filename` and `mode` of `thumbnail` or `full`). `inlineImageMode` sets the default mode. See [Comments and attachments](comments.md).
- `jira_get_attachment` saves the file to a temp path by default. Pass `"inlineBase64": true` only when you need the bytes in the output.
- `jira_get` reads any REST path, for example `{"path":"/serverInfo"}` or `{"apiName":"agile","apiVersion":"1.0","path":"/board","query":{"maxResults":5}}`. `jira_request` sends other methods and rejects `GET`.
