# Quickstart

This page takes you from a saved profile to reading a ticket, previewing a comment and posting it. It assumes you finished [Install](install.md).

Replace `PROJ-123` with a real issue key from your Jira.

## 1. See your open tickets

```sh
jira-cli mine --max-results 10
```

`mine` lists issues assigned to you that are not resolved, highest priority first. The output is JSON: an `ok` flag, the tool that ran, and a `result` with `total` and an `issues` array.

## 2. Read one ticket

```sh
jira-cli show PROJ-123
```

You get the key, summary, description, status, priority, assignee, reporter, issue type, project, labels, components, fix versions and the created and updated times. To get only some fields, name them:

```sh
jira-cli show PROJ-123 --fields summary,status,comment,issuelinks
```

## 3. Search

```sh
jira-cli search --reported --order-by "priority DESC"
jira-cli search 'project = PROJ AND status = "In Progress"'
```

`search` takes optional JQL plus filters such as `--mine`, `--open` and `--project`. More in [Find and read tickets](tickets.md).

## 4. Preview a change

Every command that changes Jira starts as a dry run. This one sends nothing:

```sh
jira-cli comment PROJ-123 --body "Investigating the login issue."
```

The result has `"dryRun": true` and a message saying the mutation was not executed.

## 5. Send it

Add `--perform-action` to run the change for real:

```sh
jira-cli comment PROJ-123 --body "Investigating the login issue." --perform-action
```

The result then has `success: true` and the id of the new comment.

## Where to go from here

- [Change tickets](changes.md): create, assign, move, label, log work.
- [Comments and attachments](comments.md): files and screenshots.
- [Release boards](releases.md): everything in a project version.
- `jira-cli easy` prints ready-made command recipes as JSON, and `jira-cli --help` lists every command.
