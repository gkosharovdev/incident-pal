import React from "react";
import { render } from "ink";
import App from "./App.js";

export interface TuiOptions {
  readonly headless: boolean;
}

const MIN_COLS = 80;
const MIN_ROWS = 24;

export function launchTui(options: TuiOptions): void {
  const isHeadless = options.headless || !process.stdout.isTTY;

  if (isHeadless) {
    runHeadlessValidation();
    return;
  }

  const cols = process.stdout.columns;
  const rows = process.stdout.rows;
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    process.stderr.write(
      `Warning: terminal is ${cols}×${rows}; incident-pal TUI works best at ${MIN_COLS}×${MIN_ROWS} or larger.\n`,
    );
  }

  render(<App />);
}

export interface HeadlessValidationResult {
  readonly valid: boolean;
  readonly missing: string[];
}

export function validateHeadlessCredentials(): HeadlessValidationResult {
  const missing: string[] = [];
  if (!process.env["ANTHROPIC_API_KEY"]) missing.push("ANTHROPIC_API_KEY");
  if (!process.env["AWS_PROFILE"]) missing.push("AWS_PROFILE");
  return { valid: missing.length === 0, missing };
}

function runHeadlessValidation(): void {
  const result = validateHeadlessCredentials();
  const awsProfile = process.env["AWS_PROFILE"];

  if (!result.valid) {
    process.stderr.write(
      `Error: missing required environment variable(s): ${result.missing.join(", ")}\n` +
      `For non-interactive investigations use: incident-pal investigate --help\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `Credentials validated: ANTHROPIC_API_KEY is set, AWS_PROFILE="${awsProfile}".\n` +
    `To run a non-interactive investigation use: incident-pal investigate\n`,
  );
  process.exit(0);
}
