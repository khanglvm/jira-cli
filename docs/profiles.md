# Profiles and storage

A profile is a saved Jira address and login. Keep one per Jira server or account, pick a default, and switch when you need another. This page also covers where jira-cli keeps your password, config, cache and temp files, and the emoji setting for older Jira databases.

## Work with profiles

```sh
jira-cli profile add work --base-url https://jira.example.com --username "$JIRA_USERNAME" --password "$JIRA_PASSWORD" --default
jira-cli profile list
jira-cli profile use work
jira-cli profile show work
jira-cli profile test work
jira-cli profile remove work
```

- `profile add <id>` saves or replaces a profile. `--default` makes it the default, and the first profile you add becomes the default anyway.
- `profile list` and `profile show` hide the password.
- `profile test [id]` signs in and prints the Jira user.
- `profile remove <id>` deletes the profile and its keychain entry. Add `--keep-secret` to leave the keychain entry in place.

Optional `profile add` flags: `--name`, `--description`, `--keyword <csv>` for routing keywords, `--api-version` (default `2`) and `--supplementary-characters`. Because `profile add` replaces the whole profile, repeat every flag you still want when you update one.

The base URL can be given with or without `https://`, and a trailing `/rest/api/2` is removed.

### Choose a profile for one command

Add `--profile <id>` to any command to skip the default:

```sh
jira-cli --profile work mine
```

With no `--profile`, jira-cli uses the default profile. If there is no default but exactly one profile, it uses that one. If several exist and none is the default, it stops with `PROFILE_SELECTION_REQUIRED` and lists them.

## Where your password goes

By default the password is stored in the OS keychain, and the config file only holds a reference to it. Set `JIRA_CLI_KEYCHAIN_MODE` to change this:

| Value | Behavior |
| --- | --- |
| `required` (default) | Store in the keychain. If that fails, `profile add` fails. |
| `optional` | Try the keychain. If that fails, store the password in the config file. |
| `disabled` | Never use the keychain. Store the password in the config file. |

`JIRA_CLI_KEYCHAIN_SERVICE` changes the keychain service name from the default `com.khanglvm.jira-cli`. The config file is created with owner-only permissions (`0600`).

## Files and folders

| What | Default | Override |
| --- | --- | --- |
| Config | `~/.config/jira-cli/config.json` | `--config <path>` or `JIRA_CLI_CONFIG` |
| User cache | `~/.cache/jira-cli` | `--cache-dir <path>` or `JIRA_CLI_CACHE_DIR` |
| Temp results | `~/.cache/jira-cli/tmp` | `--tmp-dir <path>` or `JIRA_CLI_TMP_DIR` |

Older `JIRA_AGENT_*` names of these variables still work. The cache keeps lists of assignable users for 30 days (`--cache-ttl-days` changes this, `--no-cache` turns it off). Large results go to the temp folder, and `jira-cli tmp gc` removes files older than 24 hours.

Requests time out after 30 seconds. To change that, set `timeoutMs` on the profile in the config file.

## Emoji on databases without 4-byte UTF-8

A Jira Server whose database stores only 3-byte UTF-8 (MySQL `utf8`) answers HTTP 500 to a comment that holds a character above U+FFFF, such as a robot emoji, and saves nothing. To avoid that, add the profile with entity encoding:

```sh
jira-cli profile add work --base-url https://jira.example.com --username "$JIRA_USERNAME" --password "$JIRA_PASSWORD" \
  --supplementary-characters entities
```

The profile then sends those characters as decimal entities such as `&#129302;` in comment bodies, `update.comment` operations on transitions and edits, worklog comments and issue-link comments. The Jira page shows the emoji, except inside `{code}` and `{noformat}` blocks, where the entity shows as text. Summaries, descriptions and raw `jira_request` bodies are not encoded.

Reading comments and worklogs keeps the stored text in `body` or `comment`. When the page would show it differently, the read adds `decodedBody` or `decodedComment` with the emoji restored. Profiles without the setting send text unchanged. The other accepted value is `unicode`, which is the default.
