# Working on jira-cli

jira-cli is a Node.js ESM command line tool for self-hosted Jira Server 7.x (REST API v2), published to npm as `@khanglvm/jira-cli` with the `jira-cli` and `jira-agent` binaries. Run it from a checkout with `node bin/jira-cli.js`.

## Layout

- `bin/jira-cli.js` is the entry point. It prints errors as JSON on stderr and sets the exit code.
- `src/cli.js` defines every command with commander. Quick commands build tool arguments and call `invokeTool`.
- `src/tools.js` holds the tool definitions (`TOOL_DEFINITIONS`), the aliases, the dry-run gate and one `case` per tool.
- `src/jira-client.js` is the HTTP client. `src/release-board.js` builds release boards.
- `src/config-store.js` and `src/secure-keyring.js` handle profiles and the OS keychain. `src/result-store.js` handles temp-file offload, and `src/cache-store.js` the user cache.
- `skill/jira-cli/SKILL.md` is the agent skill. It ships in the npm package.

## Checks

- `npm test` runs the unit tests in `test/`.
- `npm run check` runs `jira-cli --help` as a smoke test.
- Any change to `package.json` or the files it publishes goes out through the publish workflow, so do not edit `package.json` or `.github/workflows/npm-publish.yml` for a docs change.

## Docs

`docs/` is the source of truth for this tool's documentation. docs.khangle.dev publishes the pages `docs/meta.json` lists, and llms.txt is built from the same pages for coding agents. The contract is in https://github.com/khanglvm/docs/blob/main/docs/CONTRACT.md.

- When a change adds, removes or changes a command, flag, option, config key, output format, exported API or default, update the docs page that covers it in the same commit. Add a page and list it in `docs/meta.json` when none covers it.
- Keep `docs/agents.md` exact: commands, flags, output shapes and limits, written for a coding agent.
- README sections between `<!-- docs:begin PAGE -->` and `<!-- docs:end -->` are generated. Edit the page in `docs/`, then run `node scripts/docs-readme.mjs`.
- Run `node scripts/docs-readme.mjs --check` before committing. CI runs the same check.
- Do not move or rename a published page without updating `docs/meta.json` and links to it.

Command and tool facts also live in `skill/jira-cli/SKILL.md`; keep it in step with the pages. `docs/tools.md` lists every tool in `TOOL_DEFINITIONS`, so a new tool needs a row there. Each page opens with an H1 and a one or two sentence summary, which the site uses as its description. Use plain ASCII punctuation (no em dashes).
