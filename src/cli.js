import { createRequire } from "node:module";
import { Command } from "commander";
import { CacheStore } from "./cache-store.js";
import { JiraClient } from "./jira-client.js";
import { ResultStore } from "./result-store.js";
import { TOOL_DEFINITIONS, invokeTool, resolveToolName } from "./tools.js";
import { buildProfile, defaultCacheDir, defaultConfigPath, getProfile, listProfiles, loadConfig, redactProfile, saveConfig } from "./config-store.js";
import { hydrateProfileFromKeychain, removeProfileFromKeychain, secureProfileForStorage } from "./secure-keyring.js";
import { parseCsv, readJsonArg, readTextArg, toInteger } from "./utils.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

function sharedOptions(command) {
  return command
    .option("--config <path>", "Config file path", defaultConfigPath())
    .option("--profile <id>", "Profile ID")
    .option("--result-mode <mode>", "Result mode: auto|inline|file", "auto")
    .option("--inline-max-bytes <n>", "Max inline JSON bytes", "12000")
    .option("--tmp-dir <path>", "Temp result directory")
    .option("--cache-dir <path>", "Cache directory", defaultCacheDir())
    .option("--cache-ttl-days <n>", "Cache TTL in days", "30")
    .option("--no-cache", "Disable local cache")
    .option("--pretty", "Pretty-print JSON output", false);
}

function storeFrom(opts) {
  return new ResultStore({
    mode: opts.resultMode,
    inlineMaxBytes: toInteger(opts.inlineMaxBytes, 12000),
    tmpDir: opts.tmpDir,
    pretty: !!opts.pretty,
  });
}

function commandOptions(command) {
  const defaults = {
    config: defaultConfigPath(),
    resultMode: "auto",
    inlineMaxBytes: "12000",
    cacheDir: defaultCacheDir(),
    cacheTtlDays: "30",
    cache: true,
    pretty: false,
  };
  if (!command || typeof command.opts !== "function") {
    return { ...defaults, ...(command || {}) };
  }
  if (typeof command.optsWithGlobals === "function") {
    return { ...defaults, ...command.optsWithGlobals() };
  }
  const chain = [];
  let current = command;
  while (current) {
    chain.unshift(current);
    current = current.parent;
  }
  return chain.reduce((acc, item) => ({ ...acc, ...(typeof item.opts === "function" ? item.opts() : {}) }), defaults);
}

function localOptions(commandOrOptions) {
  if (!commandOrOptions) {
    return {};
  }
  return typeof commandOrOptions.opts === "function" ? commandOrOptions.opts() : commandOrOptions;
}

async function clientFromOptions(opts) {
  const config = await loadConfig(opts.config);
  const profile = hydrateProfileFromKeychain({
    configPath: opts.config,
    profile: getProfile(config, opts.profile),
  });
  return { config, profile, client: new JiraClient(profile) };
}

function cacheFromOptions(opts, profile) {
  if (opts.cache === false) {
    return null;
  }
  return new CacheStore({
    dir: opts.cacheDir,
    ttlDays: toInteger(opts.cacheTtlDays, 30),
    namespace: profile?.id || "default",
  });
}

async function emitWith(command, value, label) {
  await storeFrom(commandOptions(command)).emit(value, { label });
}

function appendOption(value, previous = []) {
  return [...previous, value];
}

function parseJsonOption(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return JSON.parse(value);
}

function repeatedCsv(value) {
  return parseCsv(value);
}

const EASY_RECIPES = [
  {
    name: "my-open-issues",
    command: "jira-cli mine --max-results 20",
    toolCall: "jira-cli invoke search --args '{\"jql\":\"assignee = currentUser() AND resolution IS EMPTY ORDER BY priority DESC, updated DESC\",\"maxResults\":20}'",
  },
  {
    name: "show-issue",
    command: "jira-cli show PROJ-123",
    toolCall: "jira-cli invoke get_issue --args '{\"issueKey\":\"PROJ-123\"}'",
  },
  {
    name: "create-task",
    command: "jira-cli create PROJ \"Fix login edge case\" --issue-type Bug --description \"Steps...\" --perform-action",
    toolCall: "jira-cli invoke jira_create_issue --perform-action --args '{\"projectKey\":\"PROJ\",\"summary\":\"Fix login edge case\",\"issueType\":\"Bug\",\"description\":\"Steps...\",\"performAction\":true}'",
  },
  {
    name: "comment-with-attachments",
    command: "jira-cli comment PROJ-123 --body \"Done.\" --attach screenshot.png --perform-action",
    toolCall: "jira-cli invoke comments.add-with-attachments --perform-action --args '{\"issueKey\":\"PROJ-123\",\"body\":\"Done.\",\"attachments\":[\"screenshot.png\"],\"performAction\":true}'",
  },
  {
    name: "comment-with-inline-images",
    command: "jira-cli comment PROJ-123 --body \"Evidence:\" --inline-image screenshot.png --perform-action",
    toolCall: "jira-cli invoke comments.add-with-attachments --perform-action --args '{\"issueKey\":\"PROJ-123\",\"body\":\"Evidence:\",\"inlineImages\":[\"screenshot.png\"],\"performAction\":true}'",
  },
  {
    name: "assign-to-me",
    command: "jira-cli assign PROJ-123 me --perform-action",
    toolCall: "jira-cli invoke issue.assign --perform-action --args '{\"issueKey\":\"PROJ-123\",\"username\":\"me\",\"performAction\":true}'",
  },
  {
    name: "board-users-cache",
    command: "jira-cli users --board 130 --query khang",
    toolCall: "jira-cli invoke users.board --args '{\"boardId\":\"130\",\"query\":\"khang\",\"maxResults\":10}'",
  },
  {
    name: "ticket-assign-from-board-users",
    command: "jira-cli ticket assign PROJ-123 \"Khang Le\" --board 130 --resolve-only",
    toolCall: "jira-cli invoke issue.assign --perform-action --args '{\"issueKey\":\"PROJ-123\",\"username\":\"Khang Le\",\"boardId\":\"130\",\"performAction\":true}'",
  },
  {
    name: "upload-attachments",
    command: "jira-cli attach PROJ-123 screenshot.png notes.txt --perform-action",
    toolCall: "jira-cli invoke attachments.add --perform-action --args '{\"issueKey\":\"PROJ-123\",\"attachments\":[\"screenshot.png\",\"notes.txt\"],\"performAction\":true}'",
  },
  {
    name: "transition-by-name",
    command: "jira-cli move PROJ-123 \"Done\" --comment \"Fixed.\" --perform-action",
    toolCall: "jira-cli invoke transitions.apply-by-name --perform-action --args '{\"issueKey\":\"PROJ-123\",\"transition\":\"Done\",\"comment\":\"Fixed.\",\"performAction\":true}'",
  },
  {
    name: "worklog",
    command: "jira-cli worklog PROJ-123 30m --comment \"Investigated logs\" --perform-action",
    toolCall: "jira-cli invoke worklogs.add --perform-action --args '{\"issueKey\":\"PROJ-123\",\"timeSpent\":\"30m\",\"comment\":\"Investigated logs\",\"performAction\":true}'",
  },
  {
    name: "link-issues",
    command: "jira-cli link PROJ-123 PROJ-456 --type Blocks --perform-action",
    toolCall: "jira-cli invoke links.add --perform-action --args '{\"inwardIssueKey\":\"PROJ-123\",\"outwardIssueKey\":\"PROJ-456\",\"linkType\":\"Blocks\",\"performAction\":true}'",
  },
];

export async function runCli(argv = process.argv) {
  const program = new Command();
  program
    .name("jira-cli")
    .description("Direct, profile-aware Jira Server CLI for agents")
    .version(version)
    .addHelpText("after", `

Common agent shortcuts:
  jira-cli mine
  jira-cli search --reported --max-results 20
  jira-cli show PROJ-123
  jira-cli create PROJ "Fix login edge case" --issue-type Bug --perform-action
  jira-cli assign PROJ-123 me --perform-action
  jira-cli users --board 130 --query khang
  jira-cli ticket assign PROJ-123 "Khang Le" --board 130 --resolve-only
  jira-cli move PROJ-123 "Done" --comment "Fixed." --perform-action
  jira-cli comment PROJ-123 --body "Done." --attach screenshot.png --perform-action
  jira-cli comment PROJ-123 --body "Evidence:" --inline-image screenshot.png --perform-action
  jira-cli invoke comments.add-with-attachments --perform-action --args '{"issueKey":"PROJ-123","body":"Done.","attachments":["screenshot.png"],"performAction":true}'

Run 'jira-cli easy' for JSON recipes.
`);

  sharedOptions(program);

  const profile = program.command("profile").description("Manage Jira workspaces/accounts");

  profile.command("add <id>")
    .description("Add or update a Jira profile")
    .requiredOption("--base-url <url>", "Jira base URL")
    .requiredOption("--username <username>", "Jira username")
    .requiredOption("--password <password>", "Jira password")
    .option("--api-version <version>", "Jira REST API version", "2")
    .option("--name <name>", "Display name")
    .option("--description <text>", "Profile description")
    .option("--keyword <csv>", "Comma-separated routing keywords")
    .option("--default", "Set as default profile")
    .action(async function (id) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const config = await loadConfig(opts.config);
      const local = localOptions(cmd);
      const built = buildProfile({ id, ...local });
      const secured = secureProfileForStorage({ configPath: opts.config, profileId: id, profile: built });
      config.profiles[id] = secured.profile;
      if (local.default || !config.defaultProfile) {
        config.defaultProfile = id;
      }
      await saveConfig(opts.config, config);
      await emitWith(cmd, { ok: true, profile: redactProfile({ id, ...secured.profile }), keychain: secured.keychain }, "profile-add");
    });

  profile.command("list")
    .description("List saved profiles")
    .action(async function () {
      const cmd = this;
      const opts = commandOptions(cmd);
      const config = await loadConfig(opts.config);
      await emitWith(cmd, {
        ok: true,
        defaultProfile: config.defaultProfile,
        profiles: listProfiles(config).map((item) => ({ ...redactProfile(item), isDefault: item.id === config.defaultProfile })),
      }, "profile-list");
    });

  profile.command("show [id]")
    .description("Show a redacted profile")
    .action(async function (id) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const config = await loadConfig(opts.config);
      await emitWith(cmd, { ok: true, profile: redactProfile(getProfile(config, id || opts.profile)) }, "profile-show");
    });

  profile.command("use <id>")
    .description("Set default profile")
    .action(async function (id) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const config = await loadConfig(opts.config);
      getProfile(config, id);
      config.defaultProfile = id;
      await saveConfig(opts.config, config);
      await emitWith(cmd, { ok: true, defaultProfile: id }, "profile-use");
    });

  profile.command("remove <id>")
    .description("Remove a profile")
    .option("--keep-secret", "Do not remove OS keychain secret")
    .action(async function (id) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const config = await loadConfig(opts.config);
      const existing = config.profiles[id];
      getProfile(config, id);
      const local = localOptions(cmd);
      const keychain = local.keepSecret ? { removed: false, reason: "kept" } : removeProfileFromKeychain({ configPath: opts.config, profileId: id, profile: existing });
      delete config.profiles[id];
      if (config.defaultProfile === id) {
        config.defaultProfile = Object.keys(config.profiles)[0] || null;
      }
      await saveConfig(opts.config, config);
      await emitWith(cmd, { ok: true, removed: id, keychain, defaultProfile: config.defaultProfile }, "profile-remove");
    });

  profile.command("test [id]")
    .description("Verify profile authentication")
    .action(async function (id) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const { profile: selected } = await clientFromOptions({ ...opts, profile: id || opts.profile });
      const client = new JiraClient(selected);
      const user = await client.getCurrentUser();
      await emitWith(cmd, { ok: true, profile: selected.id, baseUrl: selected.baseUrl, user: { name: user.name, displayName: user.displayName, emailAddress: user.emailAddress } }, "profile-test");
    });

  const tools = program.command("tools").description("Inspect Jira tool contracts");
  tools.command("list").description("List tools").action(async function () {
    const cmd = this;
    await emitWith(cmd, { ok: true, tools: TOOL_DEFINITIONS }, "tools-list");
  });
  tools.command("help [tool]").description("Show one tool contract").action(async function (tool) {
    const cmd = this;
    const selected = tool ? TOOL_DEFINITIONS.find((item) => item.name === resolveToolName(tool)) : null;
    await emitWith(cmd, { ok: true, ...(selected ? { tool: selected } : { tools: TOOL_DEFINITIONS }) }, "tools-help");
  });

  program.command("easy")
    .description("Show quick agent recipes for common Jira work")
    .action(async function () {
      const cmd = this;
      await emitWith(cmd, { ok: true, recipes: EASY_RECIPES }, "easy");
    });

  program.command("mine")
    .description("Quick list current user's unresolved issues")
    .option("--max-results <n>", "Maximum issues", "20")
    .action(async function () {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "search", {
        jql: "assignee = currentUser() AND resolution IS EMPTY ORDER BY priority DESC, updated DESC",
        maxResults: toInteger(local.maxResults, 20),
      });
      await emitWith(cmd, { ok: true, tool: "jira_search", result }, "mine");
    });

  program.command("search [jql]")
    .description("Quick search issues with useful daily filters")
    .option("--mine", "Assignee is current user")
    .option("--reported", "Reporter is current user")
    .option("--watched", "Issues watched by current user")
    .option("--open", "Only unresolved issues")
    .option("--project <key>", "Project key")
    .option("--status-category <name>", "Status category")
    .option("--order-by <clause>", "ORDER BY clause", "updated DESC")
    .option("--max-results <n>", "Maximum issues", "20")
    .option("--fields <csv>", "Comma-separated fields")
    .action(async function (jql) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const clauses = [];
      if (jql) clauses.push(`(${jql})`);
      if (local.mine) clauses.push("assignee = currentUser()");
      if (local.reported) clauses.push("reporter = currentUser()");
      if (local.watched) clauses.push("issue in watchedIssues()");
      if (local.open) clauses.push("resolution IS EMPTY");
      if (local.project) clauses.push(`project = ${local.project}`);
      if (local.statusCategory) clauses.push(`statusCategory = "${local.statusCategory}"`);
      const finalJql = `${clauses.length ? clauses.join(" AND ") : "ORDER BY updated DESC"}`.includes("ORDER BY")
        ? (clauses.length ? clauses.join(" AND ") : "ORDER BY updated DESC")
        : `${clauses.join(" AND ")} ORDER BY ${local.orderBy}`;
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "search", {
        jql: finalJql,
        maxResults: toInteger(local.maxResults, 20),
        fields: parseCsv(local.fields),
      });
      await emitWith(cmd, { ok: true, tool: "jira_search", jql: finalJql, result }, "search");
    });

  program.command("show <issueKey>")
    .description("Quick show one issue")
    .option("--fields <fields>", "Comma-separated Jira fields")
    .option("--expand <expand>", "Jira expand value")
    .action(async function (issueKey) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "get_issue", { issueKey, fields: local.fields, expand: local.expand });
      await emitWith(cmd, { ok: true, tool: "jira_get_issue", result }, "show");
    });

  program.command("create <projectKey> <summary>")
    .description("Quick create an issue")
    .option("--issue-type <name>", "Issue type", "Task")
    .option("--description <text>", "Issue description")
    .option("--description-file <path>", "Read description from file")
    .option("--assignee <username>", "Assignee username")
    .option("--priority <name>", "Priority name")
    .option("--label <label>", "Add label (repeatable)", appendOption, [])
    .option("--fields <json>", "Extra fields JSON object")
    .option("--perform-action", "Execute the mutation")
    .action(async function (projectKey, summary) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const description = await readTextArg({ value: local.description, file: local.descriptionFile, fallback: undefined });
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "jira_create_issue", {
        projectKey,
        summary,
        issueType: local.issueType,
        description,
        assignee: local.assignee,
        priority: local.priority,
        labels: local.label,
        fields: parseJsonOption(local.fields),
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_create_issue", result }, "create");
    });

  program.command("assign <issueKey> <username>")
    .description("Quick assign issue to username/display name/email, me, auto, or none")
    .option("--board <id>", "Resolve person from cached board users")
    .option("--project <key>", "Resolve person from cached project assignable users")
    .option("--refresh-cache", "Refresh cached user list")
    .option("--resolve-only", "Resolve the person without assigning")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey, username) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client, profile } = await clientFromOptions(opts);
      const cache = cacheFromOptions(opts, profile);
      if (local.resolveOnly) {
        const result = await invokeTool(client, "users.board", {
          boardId: local.board,
          projectKey: local.project,
          issueKey,
          query: username,
          maxResults: 10,
          refreshCache: !!local.refreshCache,
        }, { cache });
        await emitWith(cmd, { ok: true, tool: "jira_get_board_users", mode: "resolve-only", result }, "assign-resolve");
        return;
      }
      const result = await invokeTool(client, "issue.assign", {
        issueKey,
        username,
        boardId: local.board,
        projectKey: local.project,
        refreshCache: !!local.refreshCache,
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction, cache });
      await emitWith(cmd, { ok: true, tool: "jira_assign_issue", result }, "assign");
    });

  const ticket = program.command("ticket").description("Natural Jira ticket shortcuts");
  ticket.command("assign <issueKey> <username>")
    .description("Alias for assign, with optional board/project user resolution")
    .option("--board <id>", "Resolve person from cached board users")
    .option("--project <key>", "Resolve person from cached project assignable users")
    .option("--refresh-cache", "Refresh cached user list")
    .option("--resolve-only", "Resolve the person without assigning")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey, username) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client, profile } = await clientFromOptions(opts);
      const cache = cacheFromOptions(opts, profile);
      if (local.resolveOnly) {
        const result = await invokeTool(client, "users.board", {
          boardId: local.board,
          projectKey: local.project,
          issueKey,
          query: username,
          maxResults: 10,
          refreshCache: !!local.refreshCache,
        }, { cache });
        await emitWith(cmd, { ok: true, tool: "jira_get_board_users", mode: "resolve-only", result }, "ticket-assign-resolve");
        return;
      }
      const result = await invokeTool(client, "issue.assign", {
        issueKey,
        username,
        boardId: local.board,
        projectKey: local.project,
        refreshCache: !!local.refreshCache,
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction, cache });
      await emitWith(cmd, { ok: true, tool: "jira_assign_issue", result }, "ticket-assign");
    });

  program.command("move <issueKey> <transition>")
    .description("Quick transition issue by transition id/name or destination status")
    .option("--comment <text>", "Transition comment")
    .option("--fields <json>", "Transition fields JSON object")
    .option("--update <json>", "Transition update JSON object")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey, transition) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "transitions.apply-by-name", {
        issueKey,
        transition,
        comment: local.comment,
        fields: parseJsonOption(local.fields),
        update: parseJsonOption(local.update),
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_transition_issue_by_name", result }, "move");
    });

  program.command("label <issueKey>")
    .description("Quick add, remove, or set labels")
    .option("--add <csv>", "Labels to add")
    .option("--remove <csv>", "Labels to remove")
    .option("--set <csv>", "Replace labels")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "issue.labels", {
        issueKey,
        add: repeatedCsv(local.add),
        remove: repeatedCsv(local.remove),
        set: local.set ? repeatedCsv(local.set) : undefined,
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_update_labels", result }, "label");
    });

  program.command("comment <issueKey>")
    .description("Quick add a comment, optionally with attachments or inline images")
    .option("--body <text>", "Comment body")
    .option("--body-file <path>", "Read comment body from file")
    .option("--stdin", "Read comment body from stdin")
    .option("--attach <path>", "Attach a local file path (repeatable)", appendOption, [])
    .option("--inline-image <path>", "Attach an image and append Jira wiki markup (repeatable)", appendOption, [])
    .option("--inline-image-mode <mode>", "Inline image mode: thumbnail|full", "thumbnail")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const body = await readTextArg({ value: local.body, file: local.bodyFile, stdin: local.stdin });
      if (!body.trim()) {
        throw new Error("Comment body is required. Use --body, --body-file, or --stdin.");
      }
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "comments.add-with-attachments", {
        issueKey,
        body,
        attachments: local.attach || [],
        inlineImages: local.inlineImage || [],
        inlineImageMode: local.inlineImageMode,
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_comment_with_attachments", result }, "comment");
    });

  program.command("worklog <issueKey> <timeSpent>")
    .description("Quick add a worklog")
    .option("--comment <text>", "Worklog comment")
    .option("--started <timestamp>", "Jira timestamp, e.g. 2026-07-07T09:00:00.000+0700")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey, timeSpent) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "worklogs.add", { issueKey, timeSpent, comment: local.comment, started: local.started, performAction: !!local.performAction }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_add_worklog", result }, "worklog");
    });

  program.command("link <inwardIssueKey> <outwardIssueKey>")
    .description("Quick link two issues")
    .option("--type <name>", "Issue link type", "Relates")
    .option("--comment <text>", "Optional link comment")
    .option("--perform-action", "Execute the mutation")
    .action(async function (inwardIssueKey, outwardIssueKey) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "links.add", { inwardIssueKey, outwardIssueKey, linkType: local.type, comment: local.comment, performAction: !!local.performAction }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_link_issues", result }, "link");
    });

  program.command("remote-link <issueKey> <url> <title>")
    .description("Quick add/update a remote link")
    .option("--relationship <text>", "Relationship label")
    .option("--global-id <id>", "Stable global id for upsert")
    .option("--summary <text>", "Remote link summary")
    .option("--application-type <type>", "Application type", "external")
    .option("--application-name <name>", "Application name", "External Link")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey, url, title) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "remotelinks.add", {
        issueKey,
        url,
        title,
        relationship: local.relationship,
        globalId: local.globalId,
        summary: local.summary,
        applicationType: local.applicationType,
        applicationName: local.applicationName,
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_upsert_remote_link", result }, "remote-link");
    });

  program.command("watch <issueKey> [username]")
    .description("Quick watch or unwatch an issue")
    .option("--remove", "Remove watcher")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey, username = "me") {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const tool = local.remove ? "watchers.remove" : "watchers.add";
      const result = await invokeTool(client, tool, { issueKey, username, performAction: !!local.performAction }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: local.remove ? "jira_remove_watcher" : "jira_add_watcher", result }, "watch");
    });

  program.command("vote <issueKey>")
    .description("Quick vote or unvote an issue")
    .option("--remove", "Remove vote")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const tool = local.remove ? "votes.remove" : "votes.add";
      const result = await invokeTool(client, tool, { issueKey, performAction: !!local.performAction }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: local.remove ? "jira_remove_vote" : "jira_add_vote", result }, "vote");
    });

  program.command("users")
    .description("Quick list cached assignable users for a board/project/issue")
    .option("--board <id>", "Board id")
    .option("--project <key>", "Project key")
    .option("--issue <key>", "Issue key")
    .option("--query <text>", "Filter by name, username, or email")
    .option("--max-results <n>", "Maximum users", "50")
    .option("--issue-sample-size <n>", "Board issue sample used to discover projects", "100")
    .option("--refresh-cache", "Refresh cached user list")
    .action(async function () {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client, profile } = await clientFromOptions(opts);
      const result = await invokeTool(client, "users.board", {
        boardId: local.board,
        projectKey: local.project,
        issueKey: local.issue,
        query: local.query,
        maxResults: toInteger(local.maxResults, 50),
        issueSampleSize: toInteger(local.issueSampleSize, 100),
        refreshCache: !!local.refreshCache,
      }, { cache: cacheFromOptions(opts, profile) });
      await emitWith(cmd, { ok: true, tool: "jira_get_board_users", result }, "users");
    });

  program.command("attach <issueKey> <files...>")
    .description("Quick upload one or more attachments")
    .option("--perform-action", "Execute the mutation")
    .action(async function (issueKey, files) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "attachments.add", {
        issueKey,
        attachments: files,
        performAction: !!local.performAction,
      }, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: "jira_add_attachment", result }, "attach");
    });

  program.command("boards")
    .description("Quick list Jira Agile boards")
    .option("--project <keyOrId>", "Project key or id")
    .option("--type <type>", "Board type")
    .option("--name <name>", "Board name filter")
    .option("--max-results <n>", "Maximum boards", "20")
    .action(async function () {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "boards.list", {
        projectKeyOrId: local.project,
        type: local.type,
        name: local.name,
        maxResults: toInteger(local.maxResults, 20),
      });
      await emitWith(cmd, { ok: true, tool: "jira_list_boards", result }, "boards");
    });

  program.command("sprints <boardId>")
    .description("Quick list sprints for a board")
    .option("--state <state>", "active|future|closed")
    .option("--max-results <n>", "Maximum sprints", "20")
    .action(async function (boardId) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, "sprints.list", {
        boardId,
        state: local.state,
        maxResults: toInteger(local.maxResults, 20),
      });
      await emitWith(cmd, { ok: true, tool: "jira_get_sprints", result }, "sprints");
    });

  program.command("invoke <tool>")
    .description("Invoke one Jira tool")
    .option("--args <json>", "JSON tool args")
    .option("--args-file <path>", "Read JSON args from file")
    .option("--stdin", "Read JSON args from stdin")
    .option("--perform-action", "Execute mutating tools")
    .action(async function (tool) {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const args = await readJsonArg({ value: local.args, file: local.argsFile, stdin: local.stdin });
      const { client, profile } = await clientFromOptions(opts);
      const result = await invokeTool(client, tool, args, { performAction: !!local.performAction, cache: cacheFromOptions(opts, profile) });
      await emitWith(cmd, { ok: true, tool: resolveToolName(tool), result }, resolveToolName(tool));
    });

  program.command("batch")
    .description("Invoke independent Jira tools in one process")
    .option("--ops <json>", "JSON array of {tool,args}")
    .option("--ops-file <path>", "Read ops JSON from file")
    .option("--stdin", "Read ops JSON from stdin")
    .option("--perform-action", "Allow mutating ops to execute when args also include performAction:true")
    .action(async function () {
      const cmd = this;
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const ops = await readJsonArg({ value: local.ops, file: local.opsFile, stdin: local.stdin, fallback: [] });
      const { client, profile } = await clientFromOptions(opts);
      const cache = cacheFromOptions(opts, profile);
      const results = [];
      for (const [index, op] of ops.entries()) {
        try {
          const tool = resolveToolName(op.tool);
          const result = await invokeTool(client, tool, op.args || {}, { performAction: !!local.performAction && !!op.args?.performAction, cache });
          results.push({ index, ok: true, tool, result });
        } catch (err) {
          results.push({ index, ok: false, tool: op.tool, error: err?.name || "Error", message: err?.message || String(err), details: err?.details });
        }
      }
      await emitWith(cmd, { ok: results.every((item) => item.ok), results }, "batch");
    });

  const tmp = program.command("tmp").description("Inspect temp result files");
  tmp.command("list").action(async function () {
    const cmd = this;
    await emitWith(cmd, { ok: true, files: await storeFrom(commandOptions(cmd)).list() }, "tmp-list");
  });
  tmp.command("cat <file>").action(async function (file) {
    const cmd = this;
    const result = await storeFrom(commandOptions(cmd)).read(file);
    process.stdout.write(result.content);
  });
  tmp.command("gc").option("--older-than-hours <n>", "Age threshold", "24").action(async function () {
    const cmd = this;
    await emitWith(cmd, { ok: true, ...(await storeFrom(commandOptions(cmd)).gc(toInteger(localOptions(cmd).olderThanHours, 24))) }, "tmp-gc");
  });

  await program.parseAsync(argv);
}
