# Changelog

## Unreleased

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
