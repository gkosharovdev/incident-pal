const MIN_COLS = 80;
const MIN_ROWS = 24;

export interface TuiOptions {
  readonly headless: boolean;
}

export interface HeadlessValidationResult {
  readonly valid: boolean;
  readonly missing: string[];
}

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

  // Typed as string so the main tsconfig doesn't resolve this path to JSX files.
  // launch.tsx is compiled separately by tsconfig.tui.json and loaded at runtime.
  const renderModule: string = "./launch.js";
  void (import(renderModule) as Promise<{ renderApp: () => void }>)
    .then(({ renderApp }) => { renderApp(); })
    .catch((err: unknown) => {
      process.stderr.write(`Failed to render TUI: ${String(err)}\n`);
      process.exit(1);
    });
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
