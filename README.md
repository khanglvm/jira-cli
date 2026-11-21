# jira-cli

<!-- docs:begin index.md -->
jira-cli is a command line tool for self-hosted Jira Server. It lists your tickets, shows one, searches with JQL, adds comments and screenshots, and moves a ticket through its workflow, all from the terminal.

It targets Jira Server 7.x and REST API v2. Each command runs as a short process that calls Jira directly and prints JSON, so the same commands work for you, for scripts and for AI coding agents, with no MCP server to run. Changes are dry runs until you add `--perform-action`, so you can read the proposed action before anything is sent.

This is an independent project, not an official Atlassian tool.

### What you can do

- See your open issues with `mine`, or search by JQL and common filters with `search`.
- Read one issue with `show`, or a whole project release with `release`.
- Create issues, assign people, move tickets, edit labels, log work, and link, watch or vote.
- Comment with attached files or inline screenshots.
- Keep several Jira accounts as named profiles and switch between them.

### Where to go next

| You want to | Read |
| --- | --- |
| Install the tool and connect to Jira | [Install](docs/install.md) |
| Run your first commands | [Quickstart](docs/quickstart.md) |
| Find and read tickets | [Find and read tickets](docs/tickets.md) |
| Create, assign, move or label tickets | [Change tickets](docs/changes.md) |
| Comment, attach files or post screenshots | [Comments and attachments](docs/comments.md) |
| Get every issue in a project version | [Release boards](docs/releases.md) |
| Use more than one Jira account, or fix emoji errors | [Profiles and storage](docs/profiles.md) |
| Look up a command or option | [Command reference](docs/commands.md) |
| Call any Jira tool by name | [Tool reference](docs/tools.md) |
| Set it up for a coding agent | [Use with coding agents](docs/agents.md) |

The older `jira-agent` command is an alias for `jira-cli`.
<!-- docs:end -->

## Install and connect

<!-- docs:begin install.md -->
Install jira-cli from npm, then save a profile that holds your Jira address and login. It needs Node.js 18.17 or newer and an account on a Jira Server.

```sh
npm install -g @khanglvm/jira-cli
jira-cli --version
```

### Connect to Jira

Put your Jira username and password in environment variables, then add a profile. Replace the example address with your own Jira URL.

```sh
export JIRA_USERNAME=your-username
export JIRA_PASSWORD=your-password

jira-cli profile add work \
  --base-url https://jira.example.com \
  --username "$JIRA_USERNAME" \
  --password "$JIRA_PASSWORD" \
  --default
```

`profile add` saves the profile to `~/.config/jira-cli/config.json` and puts the password in your OS keychain, so the config file holds no secret. Keep credentials out of source files and chat messages.

Check that the login works:

```sh
jira-cli profile test
```

It prints the Jira user you signed in as. `jira-cli profile list` shows every saved profile, with the password hidden.

If the keychain is not available, for example on a headless server, see [Profiles and storage](docs/profiles.md) for the fallback modes.

### Next steps

Run your first commands in the [Quickstart](docs/quickstart.md).
<!-- docs:end -->

## Start with your tickets

<!-- docs:begin quickstart.md -->
This page takes you from a saved profile to reading a ticket, previewing a comment and posting it. It assumes you finished [Install](docs/install.md).

Replace `PROJ-123` with a real issue key from your Jira.

### 1. See your open tickets

```sh
jira-cli mine --max-results 10
```

`mine` lists issues assigned to you that are not resolved, highest priority first. The output is JSON: an `ok` flag, the tool that ran, and a `result` with `total` and an `issues` array.

### 2. Read one ticket

```sh
jira-cli show PROJ-123
```

You get the key, summary, description, status, priority, assignee, reporter, issue type, project, labels, components, fix versions and the created and updated times. To get only some fields, name them:

```sh
jira-cli show PROJ-123 --fields summary,status,comment,issuelinks
```

### 3. Search

```sh
jira-cli search --reported --order-by "priority DESC"
jira-cli search 'project = PROJ AND status = "In Progress"'
```

`search` takes optional JQL plus filters such as `--mine`, `--open` and `--project`. More in [Find and read tickets](docs/tickets.md).

### 4. Preview a change

Every command that changes Jira starts as a dry run. This one sends nothing:

```sh
jira-cli comment PROJ-123 --body "Investigating the login issue."
```

The result has `"dryRun": true` and a message saying the mutation was not executed.

### 5. Send it

Add `--perform-action` to run the change for real:

```sh
jira-cli comment PROJ-123 --body "Investigating the login issue." --perform-action
```

The result then has `success: true` and the id of the new comment.

### Where to go from here

- [Change tickets](docs/changes.md): create, assign, move, label, log work.
- [Comments and attachments](docs/comments.md): files and screenshots.
- [Release boards](docs/releases.md): everything in a project version.
- `jira-cli easy` prints ready-made command recipes as JSON, and `jira-cli --help` lists every command.
<!-- docs:end -->

## For AI agents

Paste this into your coding assistant:

```text
Use jira-cli for my Jira task. If missing, install it with
`npm install -g @khanglvm/jira-cli`. Check `jira-cli profile list` for setup.
Run `jira-cli easy` for examples. Use release for Jira project-version links and
mine, search, or show for tickets.
Preview changes first; pass --perform-action only for changes I have asked for.
Use `jira-cli tools list` when you need the JSON tool contracts.
```

You can also install the [bundled skill](skill/jira-cli/SKILL.md):

```sh
npx skills add khanglvm/jira-cli --skill jira-cli -y
```

The exact commands, output shapes and limits are in [Use with coding agents](docs/agents.md). All pages are also one plain-text file at [docs.khangle.dev/jira-cli/llms-full.txt](https://docs.khangle.dev/jira-cli/llms-full.txt).

## More help

- Full documentation: [docs.khangle.dev/jira-cli](https://docs.khangle.dev/jira-cli), also in the [docs folder](docs/).
- `jira-cli --help` lists commands; add `--help` to any command for its options.
- [Changelog](CHANGELOG.md) | [MIT license](LICENSE)
