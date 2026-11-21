# Use with coding agents

jira-cli gives a coding agent direct Jira Server access through short-lived shell commands, with no MCP server. This page holds the setup, the exact commands, the output shapes and the limits an agent needs.

## Set up

Install the CLI and a profile once per machine (see [Install](install.md)):

```sh
npm install -g @khanglvm/jira-cli
jira-cli profile list
jira-cli profile test
```

Install the bundled skill into a project:

```sh
npx skills add khanglvm/jira-cli --skill jira-cli -y
```

Or paste this into the agent:

```text
Use jira-cli for my Jira task. If missing, install it with
`npm install -g @khanglvm/jira-cli`. Check `jira-cli profile list` for setup.
Run `jira-cli easy` for examples. Use release for Jira project-version links and
mine, search, or show for tickets.
Preview changes first; pass --perform-action only for changes I have asked for.
Use `jira-cli tools list` when you need the JSON tool contracts.
```

All pages as one plain-text file: https://docs.khangle.dev/jira-cli/llms-full.txt

## Rules

1. Read before you write. `mine`, `search`, `show`, `release`, `users`, `boards`, `sprints` and every `get`/`list` tool never change Jira.
2. Every write is a dry run unless you pass `--perform-action`. Run the write once without it and check `dryRun` in the output. Add `--perform-action` only when the user asked for that change.
3. Never print, log or paste the Jira password. Do not put it in a command you show. `profile list` and `profile show` hide it. Credentials live in the OS keychain.
4. Use `--profile <id>` when more than one Jira profile exists. Without a default, jira-cli stops with `PROFILE_SELECTION_REQUIRED`.
5. Output is one JSON object on stdout. Errors are one JSON object on stderr with exit code 1. Parse JSON; do not scrape text.
6. Check `ok`, and for a write check `result.success`. A `batch` exits 0 even when some operations fail, so read each `results[].ok`.

## Which command

| Goal | Command |
| --- | --- |
| My open issues | `jira-cli mine --max-results 20` |
| Search with filters or JQL | `jira-cli search --mine --open --max-results 20` or `jira-cli search '<jql>'` |
| One issue | `jira-cli show PROJ-123` |
| Only some fields, with comments or links | `jira-cli show PROJ-123 --fields summary,status,comment,issuelinks` |
| A project version from its URL or id | `jira-cli release <url-or-id>` |
| Create | `jira-cli create PROJ "Summary" --issue-type Bug --description "..." --perform-action` |
| Assign to me, a person, auto or nobody | `jira-cli assign PROJ-123 me\|"Name"\|auto\|none --perform-action` |
| Check who a name resolves to | `jira-cli assign PROJ-123 "Name" --board 130 --resolve-only` |
| Change status | `jira-cli move PROJ-123 "Done" --comment "Fixed." --perform-action` |
| Labels | `jira-cli label PROJ-123 --add a,b --remove c --perform-action` |
| Comment | `jira-cli comment PROJ-123 --body "text" --perform-action` |
| Comment with files | `--attach <path>` (repeatable) |
| Comment with screenshots shown inline | `--inline-image <path>` (repeatable), `--inline-image-mode thumbnail\|full` |
| Long comment text | `--body-file <path>` or `--stdin` |
| Log work | `jira-cli worklog PROJ-123 30m --comment "..." --perform-action` |
| Link issues | `jira-cli link PROJ-123 PROJ-456 --type Blocks --perform-action` |
| Link to an outside URL | `jira-cli remote-link PROJ-123 <url> "<title>" --perform-action` |
| Upload files | `jira-cli attach PROJ-123 a.png b.txt --perform-action` |
| Watch, vote | `jira-cli watch PROJ-123 --perform-action`, `jira-cli vote PROJ-123 --perform-action` (`--remove` undoes) |
| Boards and sprints | `jira-cli boards --project PROJ`, `jira-cli sprints <boardId> --state active` |
| Anything else | `jira-cli invoke <tool> --args '<json>'`, see [Tool reference](tools.md) |

For every option of every command see the [Command reference](commands.md).

## Output shapes

### Dry run

```json
{"ok":true,"tool":"jira_comment_with_attachments","result":{"ok":true,"dryRun":true,"tool":"jira_comment_with_attachments","wouldPerform":"comment_with_attachments","message":"Mutation not executed. Pass --perform-action and include performAction:true in --args.","args":{"issueKey":"PROJ-123","body":"hi","attachments":[],"inlineImages":[],"inlineImageMode":"thumbnail","performAction":false}},"dryRun":true}
```

`ok` is true because the call worked. `dryRun` is the only sign that nothing was written. When `invoke` args carry `performAction:true` but the CLI flag is missing, the `message` says the flag is missing.

### mine and search

```json
{"ok":true,"tool":"jira_search","jql":"...","result":{"total":42,"startAt":0,"maxResults":20,"issues":[{"key":"PROJ-123","id":"10001","summary":"...","status":"In Progress","statusCategory":"In Progress","priority":"High","assignee":"Display Name","assigneeName":"username","reporter":"Display Name","issueType":"Bug","project":"PROJ","labels":[],"components":[],"fixVersions":[],"created":"...","updated":"...","description":"..."}]}}
```

`mine` has the same shape without `jql`. With `--fields`, each issue holds only `key`, `id` and the named fields.

### show

```json
{"ok":true,"tool":"jira_get_issue","result":{"key":"PROJ-123","id":"10001","summary":"...","description":"...","status":"...","statusCategory":"...","priority":"...","assignee":"...","assigneeName":"...","reporter":"...","issueType":"...","project":"PROJ","labels":[],"components":[],"fixVersions":[],"created":"...","updated":"..."}}
```

Absent values are `null`. With `--fields comment`, `result.comment` is `{"total":n,"comments":[{"id","author","authorName","created","updated","body"}]}`, and `decodedBody` appears when the page would show different text (emoji setting). With `--fields issuelinks`, `result.issuelinks` is a list of `{"id","type","direction":"inward|outward","description","issue":{"key","summary","status"}}`.

### Write results

| Command | `result` on success |
| --- | --- |
| `create` | `{"success":true,"key","id","self"}` |
| `assign` | `{"success":true,"issueKey","assignee":"<username>"}` |
| `move` | `{"success":true,"issueKey","transitionId","transitionName","toStatus"}` |
| `label --set` | `{"success":true,"issueKey","labels":{"set":[...]}}` |
| `comment` | `{"success":true,"issueKey","comment":{"id","author","created"},"attachments":{"total","files":[...]},"inlineImages":{"total","files":[...]}}` |
| `worklog` | `{"success":true,"worklog":{...}}` |
| `link` | `{"success":true,"inwardIssueKey","outwardIssueKey","linkType"}` |
| `watch` | `{"success":true,"issueKey","watcher"}` (`removedWatcher` with `--remove`) |
| `vote` | `{"success":true,"issueKey","voted":true\|false}` |

### release

`result` has `source`, `release`, `counts` (`direct`, `children`, `total`, `unresolvedDirect`, `affected`, `byStatusCategory`), `issues` (direct issues, each with `relationship`, `parent`, `children`), `issueKeys` and `completeness` (`complete`, `directIssuePages`, `childrenRequested`, `childrenHydrated`, `errors`). Treat `completeness.complete: false` as a partial result and report `errors`. Descriptions are omitted.

### Large results

When the output is bigger than 12000 bytes, stdout is only:

```json
{"ok":true,"stored":true,"file":"/path/to/result.json","bytes":48211,"hint":"Inspect with jq '.' \"/path/to/result.json\" | head"}
```

Read the data with `jira-cli tmp cat <file>` or `jq`. Use `--result-mode inline` to force direct output, or `--fields` and `--max-results` to ask for less.

### Errors

stderr, exit code 1:

```json
{"ok":false,"error":"CliError","message":"Profile not found: nope","details":{"code":"PROFILE_NOT_FOUND","profileId":"nope","availableProfiles":["work"]}}
```

`JiraApiError` carries `statusCode` (the HTTP status; 408 for a timeout) and, for Jira errors, the message from Jira. Other errors, such as an ambiguous or unknown transition or an ambiguous assignee, are plain `Error` with the choices in `message`. There is no other exit code. Success is always 0.

## Details agents get wrong

- `--perform-action` is a CLI flag. For `invoke` and `batch` you also need `"performAction": true` inside the JSON args. Quick commands add the argument for you.
- `move` takes a transition id, a transition name or a destination status name. If more than one transition matches it fails and lists `id:name -> status`. Retry with the id. List transitions with `jira-cli invoke transitions.list --args '{"issueKey":"PROJ-123"}'`.
- Status changes must use workflow transitions. Never edit the status field directly.
- `assign` resolves names against the issue's assignable users, or against `--board` or `--project`. Several matches fail with the list of candidates. Use `me`, `auto` or `none` for those cases.
- `jira-cli users` and `assign` read a cache that lasts 30 days. Pass `--refresh-cache` when someone joined recently.
- `search` accepts a trailing `ORDER BY` in the JQL. It overrides `--order-by`.
- JQL: `statusCategory` takes only `To Do`, `In Progress` or `Done`. Issue types go in `type` or `issuetype`. Never write `type = "To Do"`. Quote values with spaces.
- `release` accepts a URL on the profile's own Jira host, or a numeric version id. It refuses other hosts.
- `--inline-image` adds Jira wiki markup (`!file.png|thumbnail!`) to the comment. `--attach` does not change the comment text.
- On a Jira database without 4-byte UTF-8, a comment with an emoji fails with HTTP 500. Add the profile with `--supplementary-characters entities` (see [Profiles and storage](profiles.md)).

## Limits

- Target: Jira Server 7.x, REST API v2 (profile `--api-version`, default `2`), Basic authentication.
- `mine` and `search` return 20 issues by default. `jira_search` through `invoke` defaults to 50. Use `--max-results` to ask for more. To page, call `jira-cli invoke jira_search` with `startAt`.
- A release board holds at most 5000 direct issues. Beyond that the command fails. It reads 100 issues per page and loads subtasks 6 at a time.
- Requests time out after 30 seconds by default (profile `timeoutMs`). Nothing is retried.
- `jira_move_issues_to_sprint` and `jira_move_issues_to_backlog` take up to 50 issues.
- Output over 12000 bytes goes to a temp file. `tmp gc` removes files older than 24 hours.
- Attachment downloads (`jira_get_attachment`) save to a temp file and return its path. Bytes inline only with `"inlineBase64": true`.

## Environment

| Variable | Use |
| --- | --- |
| `JIRA_CLI_CONFIG` | Config file, default `~/.config/jira-cli/config.json` |
| `JIRA_CLI_CACHE_DIR` | Cache folder, default `~/.cache/jira-cli` |
| `JIRA_CLI_TMP_DIR` | Temp results, default `~/.cache/jira-cli/tmp` |
| `JIRA_CLI_KEYCHAIN_MODE` | `required` (default), `optional` or `disabled` |
| `JIRA_CLI_KEYCHAIN_SERVICE` | Keychain service, default `com.khanglvm.jira-cli` |

jira-cli does not read `JIRA_USERNAME` or `JIRA_PASSWORD`; pass them to `profile add` as `--username` and `--password`. A profile must exist before any Jira command runs. Without one the error is `PROFILE_NOT_CONFIGURED`.
