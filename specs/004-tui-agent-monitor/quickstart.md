# Quickstart: TUI Agent Monitor

**Date**: 2026-05-01 | **Branch**: `004-tui-agent-monitor`

---

## Prerequisites

- Node.js ≥ 22
- `npm install` completed (includes native `keytar` build via `node-gyp`)
- On Linux: `libsecret-devel` (Fedora/RHEL) or `libsecret-1-dev` (Debian/Ubuntu) installed before `npm install`
- On macOS: Xcode Command Line Tools installed (`xcode-select --install`)

---

## Build

```bash
# Compile agent, tools, and CLI (existing)
npm run build

# Compile TUI (new step — uses tsconfig.tui.json)
npm run build:tui
```

Both outputs land in `dist/`. The existing `incident-pal` binary in `dist/cli/index.js` is the entry point for both the CLI and TUI.

---

## Run the TUI (Interactive Mode)

```bash
# After build
node dist/cli/index.js tui

# Or if installed globally
incident-pal tui
```

**First launch**: the credential setup wizard appears. Enter your Anthropic API key (masked) and select an AWS profile from the list. Credentials are saved to the OS keychain.

**Subsequent launches**: the investigation form appears immediately.

---

## Run in Headless Mode

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AWS_PROFILE=my-profile

incident-pal tui --headless
# → validates credentials and exits 0 if both env vars are present
```

For running actual investigations headlessly, use the existing `incident-pal investigate` subcommand (unchanged).

---

## Keyboard Reference

| Key | Context | Action |
|-----|---------|--------|
| `Tab` / `Shift+Tab` | Any form | Move focus between fields |
| `Enter` | Form | Submit / confirm |
| `Esc` | Any screen | Cancel / go back |
| `↑` / `↓` | Stream / Report | Scroll |
| `s` | Report view | Save report to file |
| `Ctrl+S` | Form / Report / Stream | Open Settings screen |
| `Ctrl+P` | Investigation form | Open Profiles screen |
| `Ctrl+C` | Investigation running | Prompt to abort |
| `Ctrl+C` | All other screens | Quit TUI |

---

## Running Tests

```bash
# Unit tests (includes TUI component tests)
npm test

# Integration tests (includes mock-agent TUI tests)
npm run test:integration

# Type-check (covers both tsconfig.json and tsconfig.tui.json)
npm run typecheck
```

---

## Local Development Tips

- Use `npm run build:tui -- --watch` to recompile TUI code on file changes.
- Set `INCIDENT_PAL_MOCK_AGENT=1` to run the TUI against a local mock investigation agent (emits canned trace events at 500ms intervals) without needing live AWS credentials.
- The `tests/unit/tui/` directory uses `ink-testing-library` — screens can be rendered and asserted against without a live terminal.
