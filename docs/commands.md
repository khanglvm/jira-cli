# Command reference

Every jira-cli command, its arguments and its options, with the output and error format they share. Run `jira-cli <command> --help` for the same details from the installed version.

## Global options

These work on every command, before or after the command name.

| Option | Default | Meaning |
| --- | --- | --- |
| `--config <path>` | `~/.config/jira-cli/config.json` | Config file |
| `--profile <id>` | the default profile | Profile to use |
| `--result-mode <mode>` | `auto` | `auto`, `inline` or `file`. `auto` writes results over the size limit to a temp file |
| `--inline-max-bytes <n>` | `12000` | Largest result printed directly in `auto` mode |
| `--tmp-dir <path>` | `~/.cache/jira-cli/tmp` | Where temp results go |
| `--cache-dir <path>` | `~/.cache/jira-cli` | User cache folder |
| `--cache-ttl-days <n>` | `30` | How long cached users last |
| `--no-cache` | cache on | Skip the user cache |
| `--pretty` | off | Indent the JSON |
| `-V, --version` | | Print the version |
| `-h, --help` | | Print help |

## Output and errors

Every command prints one JSON object to standard output and exits 0. The shape is `{"ok": true, "tool": "<tool name>", "result": {...}}`. Commands that build a query add more keys, for example `search` adds `jql`.

When the output is larger than `--inline-max-bytes` (or `--result-mode file` is set), the command writes it to a file and prints `{"ok": true, "stored": true, "file": "<path>", "bytes": <n>, "hint": "..."}`. Read the file with `jira-cli tmp cat <path>`.

A write without `--perform-action` returns `"dryRun": true` at the top level, with `result.wouldPerform`, `result.message` and `result.args`.

On failure the command prints a JSON object to standard error and exits 1:

```json
{"ok": false, "error": "JiraApiError", "message": "...", "statusCode": 404}
```

`error` is the error name: `JiraApiError` for a Jira HTTP error, `CliError` for profile and keychain problems, or a built-in name such as `Error` or `TypeError` (a network failure reads `fetch failed`). `details` appears for `CliError` and carries a `code`, for example `PROFILE_NOT_FOUND`, `PROFILE_SELECTION_REQUIRED`, `PROFILE_NOT_CONFIGURED`, `KEYCHAIN_ERROR`, `KEYCHAIN_DISABLED` or `KEYCHAIN_SECRET_NOT_FOUND`. `statusCode` is the HTTP status from Jira. A request that exceeds the profile's timeout (30 seconds by default) fails with status 408.

## Read commands

| Command | What it does |
| --- | --- |
| `mine [--max-results <n>]` | Your unresolved issues, highest priority first. Default 20 |
| `search [jql]` | Search with JQL and filters |
| `show <issueKey>` | One issue |
| `release <releaseBoard>` | Every issue in a project version |
| `users` | Assignable users for a board, project or issue |
| `boards` | Agile boards |
| `sprints <boardId>` | Sprints of a board |
| `easy` | Command recipes as JSON, each with its quick command and its `invoke` equivalent |

`search` options: `--mine`, `--reported`, `--watched`, `--open`, `--project <key>`, `--status-category <name>`, `--order-by <clause>` (default `updated DESC`), `--max-results <n>` (default 20), `--fields <csv>`.

`show` options: `--fields <csv>`, `--expand <value>`.

`users` options: `--board <id>`, `--project <key>`, `--issue <key>`, `--query <text>`, `--max-results <n>` (default 50), `--issue-sample-size <n>` (default 100, the number of board issues sampled to find projects), `--refresh-cache`.

`boards` options: `--project <keyOrId>`, `--type <type>`, `--name <name>`, `--max-results <n>` (default 20).

`sprints` options: `--state <active|future|closed>`, `--max-results <n>` (default 20).

## Write commands

Each of these accepts `--perform-action` and is a dry run without it.

| Command | What it does |
| --- | --- |
| `create <projectKey> <summary>` | Create an issue |
| `assign <issueKey> <username>` | Assign an issue. Alias: `ticket assign` |
| `move <issueKey> <transition>` | Run a workflow transition |
| `label <issueKey>` | Add, remove or set labels |
| `comment <issueKey>` | Add a comment, optionally with files or images |
| `worklog <issueKey> <timeSpent>` | Log work |
| `link <inwardIssueKey> <outwardIssueKey>` | Link two issues |
| `remote-link <issueKey> <url> <title>` | Add or update a link to an outside URL |
| `watch <issueKey> [username]` | Watch an issue. `username` defaults to `me` |
| `vote <issueKey>` | Vote for an issue |
| `attach <issueKey> <files...>` | Upload files to an issue |

Options by command:

| Command | Options |
| --- | --- |
| `create` | `--issue-type <name>` (default `Task`), `--description <text>`, `--description-file <path>`, `--assignee <username>`, `--priority <name>`, `--label <label>` (repeatable), `--fields <json>` |
| `assign`, `ticket assign` | `--board <id>`, `--project <key>`, `--refresh-cache`, `--resolve-only` |
| `move` | `--comment <text>`, `--fields <json>`, `--update <json>` |
| `label` | `--add <csv>`, `--remove <csv>`, `--set <csv>` |
| `comment` | `--body <text>`, `--body-file <path>`, `--stdin`, `--attach <path>` (repeatable), `--inline-image <path>` (repeatable), `--inline-image-mode <thumbnail\|full>` (default `thumbnail`) |
| `worklog` | `--comment <text>`, `--started <timestamp>` |
| `link` | `--type <name>` (default `Relates`), `--comment <text>` |
| `remote-link` | `--relationship <text>`, `--global-id <id>`, `--summary <text>`, `--application-type <type>` (default `external`), `--application-name <name>` (default `External Link`) |
| `watch` | `--remove` |
| `vote` | `--remove` |

`assign` takes a username, display name or email, plus `me`, `auto` (Jira's automatic assignee) and `none`. `--resolve-only` returns the matching users without assigning, and needs no `--perform-action`.

## Profile commands

| Command | What it does |
| --- | --- |
| `profile add <id>` | Save or replace a profile. Requires `--base-url`, `--username` and `--password` |
| `profile list` | List profiles with `isDefault`, passwords hidden |
| `profile show [id]` | Show one profile, password hidden |
| `profile use <id>` | Set the default profile |
| `profile remove <id>` | Delete a profile and its keychain entry. `--keep-secret` keeps the entry |
| `profile test [id]` | Sign in and print the Jira user |

`profile add` also takes `--api-version <version>` (default `2`), `--name <name>`, `--description <text>`, `--keyword <csv>`, `--supplementary-characters <unicode|entities>` and `--default`. See [Profiles and storage](profiles.md).

## Tool commands

| Command | What it does |
| --- | --- |
| `invoke <tool>` | Run one tool. Options: `--args <json>`, `--args-file <path>`, `--stdin`, `--perform-action` |
| `batch` | Run several tools in one process. Options: `--ops <json>`, `--ops-file <path>`, `--stdin`, `--perform-action` |
| `tools list` | Print every tool contract |
| `tools help [tool]` | Print one tool contract, or all |

See the [Tool reference](tools.md).

## Temp file commands

| Command | What it does |
| --- | --- |
| `tmp list` | List stored result files, newest first |
| `tmp cat <file>` | Print a stored file. Paths outside the temp folder are refused |
| `tmp gc [--older-than-hours <n>]` | Delete stored files older than `n` hours. Default 24 |

## Environment variables

| Variable | Effect |
| --- | --- |
| `JIRA_CLI_CONFIG` | Config file path |
| `JIRA_CLI_CACHE_DIR` | Cache folder |
| `JIRA_CLI_TMP_DIR` | Temp results folder |
| `JIRA_CLI_KEYCHAIN_MODE` | `required` (default), `optional` or `disabled` |
| `JIRA_CLI_KEYCHAIN_SERVICE` | Keychain service name, default `com.khanglvm.jira-cli` |

Each has an older `JIRA_AGENT_*` twin that is used when the `JIRA_CLI_*` variable is unset, except the keychain service name. `JIRA_USERNAME` and `JIRA_PASSWORD` are not read by jira-cli; they are only a convention for passing values to `profile add`.
