#!/usr/bin/env node
import { runCli } from "../src/cli.js";

runCli().catch((err) => {
  const body = {
    ok: false,
    error: err?.name || "Error",
    message: err?.message || String(err),
    ...(err?.details ? { details: err.details } : {}),
    ...(err?.statusCode ? { statusCode: err.statusCode } : {}),
  };
  process.stderr.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exitCode = err?.exitCode || 1;
});
