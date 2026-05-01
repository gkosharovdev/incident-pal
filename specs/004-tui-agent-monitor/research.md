# Research: TUI Agent Monitor

**Date**: 2026-05-01 | **Branch**: `004-tui-agent-monitor`

---

## Decision 1: TUI Framework

**Decision**: Ink v5 (React-based)

**Rationale**: Ink is ESM-native, requires Node ≥ 20, has first-class TypeScript support, and uses React's component and hooks model for building interactive UIs in the terminal. It provides a Flexbox-based layout engine (via Yoga) that makes building complex multi-pane layouts (status bar, scrollable stream panel, form screen) straightforward. It is actively maintained and is the framework used by major CLI tools such as Gatsby CLI and Jest's interactive watch mode.

**Alternatives considered**:
- **Blessed**: ~1.2 M weekly downloads but effectively unmaintained. CommonJS-only, no native TypeScript. Ruled out.
- **terminal-kit**: Lower-level than Ink, manual state management, no TypeScript out of the box. Ruled out.
- **Unblessed** (modern fork): 100% TypeScript, ESM+CJS, but still in alpha. Not suitable for production use yet.

---

## Decision 2: OS Keychain Access

**Decision**: `keytar` (npm: `keytar`)

**Rationale**: `keytar` is the industry-standard Node.js native module for OS keychain access. It is used by VS Code, GitHub CLI, and numerous other developer tools. It supports macOS Keychain, Linux Secret Service (libsecret), and Windows Credential Manager. Node 22 compatibility requires a `node-gyp` rebuild at install time (standard for native modules; handled by `npm install`).

**Build requirement**: The project's CI/CD pipeline must have `libsecret-devel` (Linux) or Xcode Command Line Tools (macOS) available at `npm install` time. This is a standard requirement and is expected to be in place on developer workstations.

**Alternatives considered**:
- **`@vscode/keytar`**: VS Code's maintained fork; functionally equivalent. Could substitute if `keytar` becomes unmaintained, but `keytar` is sufficient today.
- **Encrypted JSON file**: Portable, no native dependency. Ruled out — key management is non-trivial and this degrades to security-through-obscurity.
- **Environment variables only (no TUI persistence)**: Valid for headless mode but eliminates the credential-setup UX entirely. Ruled out for the interactive path.

---

## Decision 3: AWS Profile Enumeration

**Decision**: `@aws-sdk/shared-ini-file-loader`

**Rationale**: This is the official AWS SDK utility for parsing `~/.aws/credentials` and `~/.aws/config`. It returns a map of profile name → parsed fields. No authentication is required — it is pure file I/O. It is already part of the AWS SDK ecosystem (which is a direct dependency), so it introduces no new vendor.

**Usage pattern**:
```
parseKnownFiles() → Record<string, ParsedIniData>
```
Profile names are the keys of the returned object.

**Alternatives considered**:
- **`@smithy/shared-ini-file-loader`**: Lower-level internal package used by the AWS SDK. Less stable public API. Ruled out in favour of the higher-level package.
- **Direct `ini` file parsing**: Lighter but reinvents wheels the AWS SDK already handles (e.g., `~/.aws/config` profile-name prefixes, include directives). Ruled out.

---

## Decision 4: React JSX and TypeScript Configuration

**Decision**: `tsconfig.tui.json` (extends root `tsconfig.json`, adds React JSX settings)

**Rationale**: The root `tsconfig.json` uses `"module": "Node16"` and has no JSX configuration, which is appropriate for the agent, tools, and CLI code. Ink requires `"jsx": "react-jsx"` and `react` in scope. Rather than altering the root tsconfig (which could affect existing build paths), a separate `tsconfig.tui.json` extends the root and overrides only the necessary fields:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/tui/**/*"]
}
```

The build script gains a `build:tui` step that compiles `src/tui/` separately. The root `build` script continues to compile everything else.

**Alternatives considered**:
- **Single tsconfig with `jsx` added**: Would require every non-TUI file to tolerate JSX settings (unnecessary and confusing). Ruled out.
- **Monorepo workspace split**: Overkill for a single additional entry point. Ruled out.

---

## Decision 5: Agent Event Streaming

**Decision**: Add optional `onTraceEntry?: (entry: TraceEntry) => void` callback to `InvestigationAgentConfig`

**Rationale**: The `InvestigationAgent.recordToolResult()` already appends each `TraceEntry` to the `Trace`. Adding a single callback invocation at that point (guarded by `if (config.onTraceEntry)`) is the minimal, backward-compatible change that enables real-time streaming to the TUI. All existing callers omit the field and are unaffected. This is observability infrastructure, not a new data source.

**Constitution note**: This change touches `src/agent/InvestigationAgent.ts`, which requires written justification per §VI. The justification (purely additive, observability-only, backward-compatible) is documented in `plan.md` Complexity Tracking and must be included in the PR description.

**Alternatives considered**:
- **Polling `Trace` at 100ms intervals**: Misses sub-100ms events, adds CPU overhead, complex to drain on completion. Ruled out.
- **Subclass / override**: Core methods are private — not possible without modifying visibility, which is a larger change. Ruled out.
- **Node.js EventEmitter on `InvestigationAgent`**: Equivalent in scope to the callback approach but heavier API surface. The callback is simpler and sufficient for the single-consumer TUI use case. Ruled out.
- **Separate tracing middleware layer**: Would require restructuring the agent's internal call chain. Disproportionate to the need. Ruled out.

---

## Decision 6: Headless Mode Detection

**Decision**: TTY absence (`process.stdout.isTTY === undefined || !process.stdout.isTTY`) triggers headless mode automatically; `--headless` CLI flag forces it regardless of TTY state.

**Rationale**: TTY detection is the standard UNIX approach (used by `git`, `npm`, `docker`). Combined with an explicit flag, operators in unusual environments (e.g., TTY-attached CI agents) can still force headless mode predictably. Environment variables sourced in headless mode: `ANTHROPIC_API_KEY` and `AWS_PROFILE`.

**Alternatives considered**:
- **`CI=true` env var detection**: Fragile — not all CI environments set this. Ruled out as primary mechanism (may be used as supplementary hint in future).
- **Flag only, no TTY detection**: Would require all piped/CI invocations to explicitly pass `--headless`. Error-prone. Ruled out.
