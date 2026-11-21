# Release boards

`release` returns every issue in a Jira project version, including subtasks, so you can see a whole release in one call. You give it the version's URL or its numeric id.

```sh
jira-cli release https://jira.example.com/projects/PROJ/versions/12345
jira-cli release 12345
```

The URL has to match `/projects/<project-key>/versions/<version-id>` and point at the same Jira host as your profile. A URL for another host is refused. The command only reads.

## What you get back

- `source`: how your input was read.
- `release`: the version's id, name, description, project, start and release dates, and whether it is released, archived or overdue, plus its URL.
- `counts`: how many issues were found directly (`direct`), how many subtasks were added (`children`) and the `total`, plus `unresolvedDirect`, `affected` and `byStatusCategory`.
- `issues`: the issues assigned directly to the version, each with its key, id, summary, type, status, status category, resolution, priority, assignee, reporter, project key, labels, components, fix versions and dates. Each one has `relationship: "direct"`, a `parent` when it has one, and a `children` array with its subtasks in full.
- `issueKeys`: every key, including parents, sorted.
- `completeness`: whether everything loaded. Check `completeness.complete` first.

jira-cli pages through the results, loads subtasks a few at a time, and compares its total with the count Jira reports for the version. If a subtask fails to load, or the counts disagree, `complete` is `false` and `errors` says what went wrong. The rest of the data is still returned. Issue descriptions are left out of release results.

## Keep everything

Release results contain every issue Jira assigns to the version. Do not drop items by title or issue type, because those do not prove an issue belongs elsewhere. Filter afterward with your own rules.

## The same call as a tool

```sh
jira-cli invoke release.get --args '{"releaseBoard":"https://jira.example.com/projects/PROJ/versions/12345"}'
```

The tool name is `jira_get_release_board`. See the [Tool reference](tools.md).
