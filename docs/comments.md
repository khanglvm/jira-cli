# Comments and attachments

Post a comment from the command line, with or without files, and show screenshots inside the comment text. Like every write, a comment is a dry run until you add `--perform-action`.

## Add a comment

```sh
jira-cli comment PROJ-123 --body "Investigating the login issue."
jira-cli comment PROJ-123 --body "Investigating the login issue." --perform-action
```

The first command previews the comment and the second posts it. For long text, read the body from a file or from standard input:

```sh
jira-cli comment PROJ-123 --body-file notes.txt --perform-action
echo "Deployed to staging." | jira-cli comment PROJ-123 --stdin --perform-action
```

A comment needs a body. If you give none, the command stops with an error.

## Attach files to a comment

```sh
jira-cli comment PROJ-123 --body "Done." --attach screenshot.png --attach notes.txt --perform-action
```

`--attach` uploads the file to the issue and leaves the comment text as you wrote it. Repeat the option for each file.

## Show screenshots inside the comment

```sh
jira-cli comment PROJ-123 --body "Evidence:" --inline-image screenshot.png --inline-image mobile.png --perform-action
```

`--inline-image` uploads every file first, then adds Jira image markup to the end of the comment so the pictures show in the text. The comment above ends with:

```text
!screenshot.png|thumbnail!
!mobile.png|thumbnail!
```

Images are thumbnails by default. Add `--inline-image-mode full` for full-size images, which use `!filename!` markup. You can combine `--attach` and `--inline-image` in one comment.

## Attach files without a comment

```sh
jira-cli attach PROJ-123 screenshot.png notes.txt --perform-action
```

## Emoji on older Jira databases

Some Jira Server databases store only 3-byte UTF-8 and answer HTTP 500 to a comment that holds an emoji or another character above U+FFFF, saving nothing. If you hit this, set up the profile to send those characters as numeric entities. See [Profiles and storage](profiles.md#emoji-on-databases-without-4-byte-utf-8).

## Read comments

`show PROJ-123 --fields comment` returns the comments on an issue, and `invoke jira_get_comments` returns them with their own fields. See [Find and read tickets](tickets.md).
