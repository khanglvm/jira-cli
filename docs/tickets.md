# Find and read tickets

Use `mine` for your own open issues, `search` for anything else, `show` for one issue, and `users`, `boards` and `sprints` to look up the people and boards around them. None of these commands change Jira.

## Your open issues

```sh
jira-cli mine --max-results 20
```

This runs `assignee = currentUser() AND resolution IS EMPTY ORDER BY priority DESC, updated DESC`. `--max-results` defaults to 20.

## Search

`search` builds JQL from filters, and you can also pass your own JQL as the first argument. The filters combine with AND.

```sh
jira-cli search --mine --open --max-results 20
jira-cli search --reported --order-by "priority DESC"
jira-cli search --watched --project PROJ
jira-cli search --status-category "In Progress"
jira-cli search 'project = PROJ AND labels = urgent ORDER BY created DESC'
```

| Option | Adds to the query |
| --- | --- |
| `--mine` | `assignee = currentUser()` |
| `--reported` | `reporter = currentUser()` |
| `--watched` | `issue in watchedIssues()` |
| `--open` | `resolution IS EMPTY` |
| `--project <key>` | `project = <key>` |
| `--status-category <name>` | `statusCategory = "<name>"` |

`--order-by` sets the sort and defaults to `updated DESC`. An `ORDER BY` written inside your own JQL wins over `--order-by`. `--max-results` defaults to 20, and `--fields` takes a comma-separated list. The output includes the final `jql` it sent, so you can see how the filters combined.

### JQL notes

- `statusCategory` only has the values `To Do`, `In Progress` and `Done`.
- `type` and `issuetype` hold issue types such as `Bug`, `Task`, `Story` and `Epic`. Never write `type = "To Do"`.
- Quote values that contain spaces.

## Read one issue

```sh
jira-cli show PROJ-123
jira-cli show PROJ-123 --fields summary,status,comment,issuelinks
```

Without `--fields`, `show` returns `key`, `id`, `summary`, `description`, `status`, `statusCategory`, `priority`, `assignee`, `assigneeName`, `reporter`, `issueType`, `project`, `labels`, `components`, `fixVersions`, `created` and `updated`.

With `--fields`, you get `key`, `id` and only the fields you named. `comment` returns the comments and `issuelinks` returns the linked issues with their direction, type and status. `--expand` passes a Jira expand value through.

## Find people, boards and sprints

```sh
jira-cli users --board 130 --query khang
jira-cli boards --project PROJ
jira-cli sprints 42 --state active
```

`users` lists people who can be assigned on a board, a project or an issue, and keeps the list in a local cache for 30 days. Use `--refresh-cache` to reload it, `--no-cache` to skip the cache, and `--cache-ttl-days` to change how long it lasts. See [Change tickets](changes.md) for assigning.

Run `jira-cli boards --help` and `jira-cli sprints --help` for their filters.

## Big results

Results larger than 12000 bytes are written to a temp file and the command prints the file path instead. Read it with `jira-cli tmp cat <file>`, or change the behavior with `--result-mode inline` or `--inline-max-bytes`. The [command reference](commands.md) lists the temp-file commands.
