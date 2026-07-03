import { createRequire } from "node:module";
import { Command } from "commander";
import { JiraClient } from "./jira-client.js";
import { ResultStore } from "./result-store.js";
import { TOOL_DEFINITIONS, invokeTool, resolveToolName } from "./tools.js";
import { buildProfile, defaultConfigPath, getProfile, listProfiles, loadConfig, readClaudeJiraEnv, redactProfile, saveConfig } from "./config-store.js";
import { hydrateProfileFromKeychain, removeProfileFromKeychain, secureProfileForStorage } from "./secure-keyring.js";
import { readJsonArg, toInteger } from "./utils.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

function sharedOptions(command) {
  return command
    .option("--config <path>", "Config file path", defaultConfigPath())
    .option("--profile <id>", "Profile ID")
    .option("--result-mode <mode>", "Result mode: auto|inline|file", "auto")
    .option("--inline-max-bytes <n>", "Max inline JSON bytes", "12000")
    .option("--tmp-dir <path>", "Temp result directory")
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
    pretty: false,
  };
  if (!command || typeof command.opts !== "function") {
    return { ...defaults, ...(command || {}) };
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

async function emitWith(command, value, label) {
  await storeFrom(commandOptions(command)).emit(value, { label });
}

export async function runCli(argv = process.argv) {
  const program = new Command();
  program
    .name("jira-cli")
    .description("Direct, profile-aware Jira Server CLI for agents")
    .version(version);

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
    .action(async (id, cmd) => {
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

  profile.command("import-claude")
    .description("Import Jira credentials from Claude Code MCP configuration")
    .option("--claude-config <path>", "Claude config path")
    .option("--server <name>", "MCP server key", "jira-mcp")
    .option("--id <id>", "Profile id")
    .option("--name <name>", "Profile display name")
    .option("--default", "Set imported profile as default")
    .action(async (cmd) => {
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const found = await readClaudeJiraEnv({ claudeConfigPath: local.claudeConfig, serverName: local.server });
      const id = local.id || "claude";
      const config = await loadConfig(opts.config);
      const built = buildProfile({
        id,
        name: local.name || "Claude Jira MCP",
        baseUrl: found.baseUrl,
        username: found.username,
        password: found.password,
        apiVersion: found.apiVersion,
        keywords: ["claude", "jira", found.username].filter(Boolean),
      });
      const secured = secureProfileForStorage({ configPath: opts.config, profileId: id, profile: built });
      config.profiles[id] = secured.profile;
      if (local.default || !config.defaultProfile) {
        config.defaultProfile = id;
      }
      await saveConfig(opts.config, config);
      await emitWith(cmd, { ok: true, importedFrom: found.file, serverName: found.serverName, profile: redactProfile({ id, ...secured.profile }), keychain: secured.keychain }, "profile-import-claude");
    });

  profile.command("list")
    .description("List saved profiles")
    .action(async (cmd) => {
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
    .action(async (id, cmd) => {
      const opts = commandOptions(cmd);
      const config = await loadConfig(opts.config);
      await emitWith(cmd, { ok: true, profile: redactProfile(getProfile(config, id || opts.profile)) }, "profile-show");
    });

  profile.command("use <id>")
    .description("Set default profile")
    .action(async (id, cmd) => {
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
    .action(async (id, cmd) => {
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
    .action(async (id, cmd) => {
      const opts = commandOptions(cmd);
      const { profile: selected } = await clientFromOptions({ ...opts, profile: id || opts.profile });
      const client = new JiraClient(selected);
      const user = await client.getCurrentUser();
      await emitWith(cmd, { ok: true, profile: selected.id, baseUrl: selected.baseUrl, user: { name: user.name, displayName: user.displayName, emailAddress: user.emailAddress } }, "profile-test");
    });

  const tools = program.command("tools").description("Inspect Jira tool contracts");
  tools.command("list").description("List tools").action(async (cmd) => {
    await emitWith(cmd, { ok: true, tools: TOOL_DEFINITIONS }, "tools-list");
  });
  tools.command("help [tool]").description("Show one tool contract").action(async (tool, cmd) => {
    const selected = tool ? TOOL_DEFINITIONS.find((item) => item.name === resolveToolName(tool)) : null;
    await emitWith(cmd, { ok: true, ...(selected ? { tool: selected } : { tools: TOOL_DEFINITIONS }) }, "tools-help");
  });

  program.command("invoke <tool>")
    .description("Invoke one Jira tool")
    .option("--args <json>", "JSON tool args")
    .option("--args-file <path>", "Read JSON args from file")
    .option("--stdin", "Read JSON args from stdin")
    .option("--perform-action", "Execute mutating tools")
    .action(async (tool, cmd) => {
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const args = await readJsonArg({ value: local.args, file: local.argsFile, stdin: local.stdin });
      const { client } = await clientFromOptions(opts);
      const result = await invokeTool(client, tool, args, { performAction: !!local.performAction });
      await emitWith(cmd, { ok: true, tool: resolveToolName(tool), result }, resolveToolName(tool));
    });

  program.command("batch")
    .description("Invoke independent Jira tools in one process")
    .option("--ops <json>", "JSON array of {tool,args}")
    .option("--ops-file <path>", "Read ops JSON from file")
    .option("--stdin", "Read ops JSON from stdin")
    .option("--perform-action", "Allow mutating ops to execute when args also include performAction:true")
    .action(async (cmd) => {
      const opts = commandOptions(cmd);
      const local = localOptions(cmd);
      const ops = await readJsonArg({ value: local.ops, file: local.opsFile, stdin: local.stdin, fallback: [] });
      const { client } = await clientFromOptions(opts);
      const results = [];
      for (const [index, op] of ops.entries()) {
        try {
          const tool = resolveToolName(op.tool);
          const result = await invokeTool(client, tool, op.args || {}, { performAction: !!local.performAction && !!op.args?.performAction });
          results.push({ index, ok: true, tool, result });
        } catch (err) {
          results.push({ index, ok: false, tool: op.tool, error: err?.name || "Error", message: err?.message || String(err), details: err?.details });
        }
      }
      await emitWith(cmd, { ok: results.every((item) => item.ok), results }, "batch");
    });

  const tmp = program.command("tmp").description("Inspect temp result files");
  tmp.command("list").action(async (cmd) => {
    await emitWith(cmd, { ok: true, files: await storeFrom(commandOptions(cmd)).list() }, "tmp-list");
  });
  tmp.command("cat <file>").action(async (file, cmd) => {
    const result = await storeFrom(commandOptions(cmd)).read(file);
    process.stdout.write(result.content);
  });
  tmp.command("gc").option("--older-than-hours <n>", "Age threshold", "24").action(async (cmd) => {
    await emitWith(cmd, { ok: true, ...(await storeFrom(commandOptions(cmd)).gc(toInteger(localOptions(cmd).olderThanHours, 24))) }, "tmp-gc");
  });

  await program.parseAsync(argv);
}
