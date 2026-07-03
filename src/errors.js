export class CliError extends Error {
  constructor(message, details = {}, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.details = details;
    this.exitCode = exitCode;
  }
}

export class JiraApiError extends Error {
  constructor(message, statusCode, body) {
    super(message);
    this.name = "JiraApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}
