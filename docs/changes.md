# Change tickets

Commands that write to Jira, such as `create`, `assign`, `move` and `label`, show what they would do and stop until you add `--perform-action`. This page covers each one.

## Preview first, then send

Without `--perform-action`, a writing command returns a dry run and sends nothing:

```sh
jira-cli move PROJ-123 "Done" --comment "Fixed."
```

The result has `"dryRun": true` at the top level, with `ok: true` because the call itself worked, plus the tool name and the arguments it would have used. Check `dryRun` before you assume a write happened. Add the flag to send it:

```sh
jira-cli move PROJ-123 "Done" --comment "Fixed." --perform-action
```

## Create an issue

```sh
jira-cli create PROJ "Fix login edge case" --issue-type Bug --description "Steps..." --perform-action
```

`--issue-type` defaults to `Task`. Other options: `--description-file <path>` to read the description from a file, `--assignee <username>`, `--priority <name>`, `--label <label>` (repeat it for more labels) and `--fields <json>` for extra Jira fields as a JSON object. The result holds the new `key`, `id` and `self` URL.

## Assign

```sh
jira-cli assign PROJ-123 me --perform-action
jira-cli assign PROJ-123 "Khang Le" --perform-action
```

The person can be a username, a display name or an email address. Three words are special: `me` is you, `auto` asks Jira for the automatic assignee, and `none` clears the assignee.

jira-cli looks the name up in the list of users who can be assigned to that issue. An exact match on username, display name or email wins. Otherwise a single partial match is used. If several people match, it stops and lists them so you can retry with a username. To resolve names against a board or a project instead, add `--board <id>` or `--project <key>`. `--refresh-cache` reloads the cached user list.

To check who a name resolves to without assigning, use `--resolve-only`:

```sh
jira-cli ticket assign PROJ-123 "Khang Le" --board 130 --resolve-only
jira-cli ticket assign PROJ-123 "Khang Le" --board 130 --perform-action
```

`ticket assign` is the same command as `assign`.

## Move through the workflow

```sh
jira-cli move PROJ-123 "Done" --comment "Fixed." --perform-action
```

The transition can be a transition id, a transition name, or the name of the status it leads to. If more than one transition matches, jira-cli refuses and prints the matching ids, so you can retry with the id you mean. If none match, it lists the transitions that are available. You can list them yourself:

```sh
jira-cli invoke transitions.list --args '{"issueKey":"PROJ-123"}'
```

`move` also accepts `--fields <json>` and `--update <json>` for transition screens that need extra input. A successful move returns the `transitionId`, `transitionName` and `toStatus`.

## Labels

```sh
jira-cli label PROJ-123 --add agent-reviewed --perform-action
jira-cli label PROJ-123 --add a,b --remove old --perform-action
jira-cli label PROJ-123 --set only-this --perform-action
```

Each option takes a comma-separated list. `--set` replaces all labels.

## Log work

```sh
jira-cli worklog PROJ-123 30m --comment "Investigated logs" --perform-action
```

The time uses Jira's format, such as `30m` or `1h 30m`. Add `--started <timestamp>` with a Jira timestamp like `2026-07-07T09:00:00.000+0700` to log work at an earlier time.

## Link issues

```sh
jira-cli link PROJ-123 PROJ-456 --type Blocks --perform-action
jira-cli remote-link PROJ-123 "https://ci.example/build/1" "CI build" --perform-action
```

`link` defaults to the `Relates` type and takes an optional `--comment`. `remote-link` adds or updates a link to an outside URL. Add `--global-id <id>` to make it update the same link on later runs, plus `--relationship`, `--summary`, `--application-type` and `--application-name` if you need them.

## Watch and vote

```sh
jira-cli watch PROJ-123 --perform-action
jira-cli watch PROJ-123 --remove --perform-action
jira-cli watch PROJ-123 some.username --perform-action
jira-cli vote PROJ-123 --perform-action
jira-cli vote PROJ-123 --remove --perform-action
```

`watch` adds you by default. Pass a username after the issue key to change another person's watch.

## Attach files

```sh
jira-cli attach PROJ-123 screenshot.png notes.txt --perform-action
```

To attach files together with a comment, see [Comments and attachments](comments.md).
