# Changelog

## Unreleased

## 0.2.4

- Ship the current README and agent skill, so the npm page matches GitHub and
  docs.khangle.dev, which now publishes the guides.

## 0.2.3

- Add the profile setting `supplementaryCharacters`. With `"entities"`, jira-cli
  sends characters above U+FFFF (most emoji, such as 🤖) as decimal HTML
  entities (`&#129302;`) in comment bodies, transition and edit
  `update.comment` operations, worklog comments and issue-link comments. Jira
  Server databases that store only 3-byte UTF-8 answer HTTP 500 to these writes
  and save nothing. The page still shows the emoji, except inside `{code}` or
  `{noformat}`, where a real emoji written there shows as entity text. Profiles
  without the setting send text unchanged. Set it with
  `profile add --supplementary-characters entities`.
- Comment reads (`jira_get_comments`, the `comment` field of `show`/`search`)
  and worklog reads keep the stored text in `body` or `comment`. When that text
  holds entities above U+FFFF outside `{code}` and `{noformat}` blocks, the read
  adds `decodedBody` or `decodedComment` with the text as the page shows it.

## 0.2.2

- `show --fields` and `jira_get_issue`/`jira_search` `fields` now return the
  requested fields, including `comment` and `issuelinks`. Before, the output was
  always the fixed summary shape, so fields outside the request showed as null.
- `search` default fields now include project, created, updated and reporter,
  which previously came back null.
- `search` accepts a trailing `ORDER BY` in the JQL instead of failing with HTTP
  400; it takes precedence over `--order-by`.
- Dry-run results are flagged with top-level `dryRun: true`, and the message
  says when `performAction:true` was passed without `--perform-action`.
  `ok` stays true because the call itself succeeded.
- Document the fields `show` returns.

## 0.2.1

- Omit issue descriptions from aggregate release-board results so credentials
  or private payloads embedded in Jira descriptions are not copied into bulk
  agent output or shipment state.

## 0.2.0

- Add `jira-cli release <url-or-version-id>` and the read-only
  `jira_get_release_board` tool for complete Jira project-version retrieval.
- Paginate direct release membership, hydrate Jira subtasks with bounded
  concurrency, and report partial child failures without losing usable data.
- Validate release URLs against the configured Jira host and canonical project.

## 0.1.5

- Refuse ambiguous transition names or destination statuses. Callers receive the
  matching transition ids and can retry with the intended id.

## 0.1.4

- Add opt-in inline comment images through `comment --inline-image` and
  `jira_comment_with_attachments.inlineImages`, using Jira wiki thumbnails by
  default with an explicit full-size mode.
- Preserve attachment-only comments while guaranteeing that inline images are
  uploaded before their generated markup is posted.

## 0.1.3

- Add quick agent commands for common Jira flows: `easy`, `mine`, `show`, `comment`, and `attach`.
- Add attachment upload support plus combined `jira_comment_with_attachments` / `comments.add-with-attachments` for one-call comment-with-files workflows.
- Add broader Jira Server 7.x and Jira Agile low-level tools for metadata, users, assignment, labels, comments, transitions, attachments, votes, watchers, worklogs, issue links, remote links, boards, sprints, and generic REST escape hatches.
- Add cached board/project assignable-user lookup (`jira-cli users`, `jira_get_board_users`) with a 30-day default TTL and inline display-name/email assignment resolution via `assign --board` / `ticket assign --board`.

## 0.1.2

- Remove the local credential import command; it was only used for pre-release testing and is not a product feature.

## 0.1.1

- Add public package metadata for the GitHub repository and npm registry.

## 0.1.0

- Initial direct Jira CLI port from `@khanglvm/jira-mcp`.
- Add multi-profile workspace/account storage with OS keychain support.
- Add dry-run mutation gating for create, update, delete, comment, and transition tools.
- Add `invoke`, `batch`, `tools`, and temp result helpers for agent workflows.
