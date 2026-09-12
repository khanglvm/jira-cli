# jira-cli

Work with Jira Server tickets from your terminal. See your open issues,
search with JQL, add comments and screenshots, or move a ticket through its
workflow. Short commands cover everyday tasks; JSON output works with scripts
and AI agents.

The focus is self-hosted Jira Server 7.x and REST API v2. It calls Jira
directly from a short-lived process, so an agent can use the same `mine`,
`show`, and `comment` commands you use, without running an MCP server. Writes start as
dry runs: you can inspect the proposed action before choosing to send it.

This is an independent project, not an official Atlassian tool.

## Install and connect

Requires Node.js 18.17 or newer and a Jira Server account.

```sh
npm install -g @khanglvm/jira-cli
```

Set `JIRA_USERNAME` and `JIRA_PASSWORD` in your local environment, then replace
the example URL with your Jira address:

```sh
jira-cli profile add work \
  --base-url https://jira.example.com \
  --username "$JIRA_USERNAME" \
  --password "$JIRA_PASSWORD" \
  --default
```

Credentials go into your OS keychain by default. Keep them out of source files
and chat messages. Use `jira-cli profile list` to see configured accounts.

## Start with your tickets

```sh
jira-cli mine --max-results 10
jira-cli show PROJ-123
jira-cli search --reported --order-by "priority DESC"
```

Replace `PROJ-123` with a real issue key. Changes are dry runs by default, so
you can preview a comment before posting it:

```sh
jira-cli comment PROJ-123 --body "Investigating the login issue."
jira-cli comment PROJ-123 --body "Investigating the login issue." --perform-action
```

Add `--inline-image screenshot.png` to include a screenshot in a comment.
Profiles let you switch between Jira workspaces with `jira-cli profile use work`.

## For AI agents

Paste this into your coding assistant:

```text
Use jira-cli for my Jira task. If missing, install it with
`npm install -g @khanglvm/jira-cli`. Check `jira-cli profile list` for setup.
Run `jira-cli easy` for examples, then use mine, search, or show to read tickets.
Preview changes first; pass --perform-action only for changes I have asked for.
Use `jira-cli tools list` when you need the JSON tool contracts.
```

You can also install the [bundled skill](skill/jira-cli/SKILL.md):

```sh
npx skills add khanglvm/jira-cli --skill jira-cli -y
```

## More help

- [Usage guide](https://github.com/khanglvm/jira-cli/blob/main/docs/USAGE.md): JQL, attachments, assignment, workflow transitions, and all tools.
- `jira-cli --help` lists commands; add `--help` to any command for its options.
- [Changelog](CHANGELOG.md) · [MIT license](LICENSE)

The older `jira-agent` command is an alias for `jira-cli`.
