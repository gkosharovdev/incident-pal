# incident-pal Constitution

## Core Principles

### I. Safety First (NON-NEGOTIABLE)

All production interactions are read-only. The system MUST NOT write, modify, delete, or trigger any state-changing operation in any production system at any point during an investigation. This constraint applies to every tool, integration, and extension — no exceptions. Any PR or change that introduces a write path to a production system is automatically rejected.

### II. Tests & Evals Always Green (NON-NEGOTIABLE)

Every merge to the main branch MUST leave all tests and evals passing. No PR is merged with a failing test or a failing eval assertion. This applies to:
- Unit tests
- Integration tests
- Agent evals (golden-set trace assertions, output structure checks, confidence calibration checks)

If an eval degrades (e.g., root-cause accuracy drops below the SC-001 threshold of 80%), the merge is blocked until the regression is resolved. Disabling or skipping a test/eval to make CI green is prohibited — fix the underlying issue instead.

### III. Clean Code & SOLID Principles (NON-NEGOTIABLE)

All production code MUST follow clean code guidelines and SOLID principles:

- **Single Responsibility**: Each class, module, and function has one reason to change.
- **Open/Closed**: Modules are open for extension (new tools, new data sources) and closed for modification of core logic.
- **Liskov Substitution**: Tool implementations are substitutable — any registered tool must satisfy the Tool interface contract without altering agent behaviour.
- **Interface Segregation**: Tool interfaces are narrow — each tool exposes only what the agent needs to invoke it, nothing more.
- **Dependency Inversion**: The agent core depends on tool abstractions, never on concrete implementations. Concrete tools are injected at runtime.

Additional clean code rules:
- Functions do one thing and are named for what they do.
- No magic numbers or strings — named constants only.
- Cyclomatic complexity per function ≤ 10.
- No commented-out code in committed files.
- Public APIs are documented with types.

### IV. Language Standards

TypeScript is the primary implementation language. Java is acceptable as an alternative if TypeScript is unsuitable for a specific integration. Python is NOT used in this project — the team has no Python expertise and the maintenance cost of Python dependencies is not acceptable.

All TypeScript code targets the latest LTS Node.js version and uses strict mode (`"strict": true` in tsconfig). No `any` types without an explicit suppression comment explaining why. Dependencies are managed via npm/yarn workspaces.

### V. Auditability & Reproducibility

Every investigation produces an append-only trace that records all tool calls (name, inputs, outputs, timestamp). Traces are never truncated or summarised — they contain the full raw record. This enables post-incident review and reproducible re-runs. Any change to the trace format is a breaking change and requires a version bump.

### VI. Extensibility via Narrow Tools

New data sources are integrated as narrow, read-only tools following the Tool interface contract. The agent core MUST NOT be modified to add support for a new data source. Core modifications require a constitution amendment. Every new tool MUST have:
- A unit test covering its query logic
- An integration test (or a recorded fixture) covering its response parsing
- An eval fixture for at least one investigation scenario that uses it

## Quality Gates

Gates are split by execution cost. PR gates run on every pull request; merge gates run on merge to main only.

**PR gates** (every pull request):

| Gate | Threshold | Blocking |
|------|-----------|----------|
| All unit tests pass | 100% | Yes |
| All integration tests pass | 100% | Yes |
| All structural eval assertions pass (Tier 1) | 100% | Yes |
| TypeScript strict mode — no type errors | 0 errors | Yes |
| Cyclomatic complexity | ≤ 10 per function | Yes |
| No production write paths | 0 violations | Yes |
| New tool has unit + integration test | Required | Yes |

**Merge-to-main gates** (merge to main branch only):

| Gate | Threshold | Blocking |
|------|-----------|----------|
| Agent root-cause accuracy — golden-set accuracy evals (Tier 2) | ≥ 80% across ≥3 observation types | Yes |
| Golden-set eval suite diversity | ≥ 3 distinct observation types | Yes |

**Rationale for split**: Tier 2 accuracy evals call the live Anthropic API against recorded fixtures. Running them on every PR would incur significant API cost and add 2–5 minutes to every PR cycle. Structural evals (Tier 1) run against mock tools with no API calls and complete in <30 seconds — these run on every PR and provide fast feedback. If a Tier 2 accuracy regression is introduced, it is caught at the merge gate before reaching main.

## Governance

This constitution supersedes all other project practices. Amendments require:
1. A written rationale documenting the change and why the current clause is insufficient.
2. Review by at least one other team member.
3. An updated version number and amendment date below.

All PRs must verify compliance with this constitution before merge. Complexity or exceptions must be documented in the plan's Complexity Tracking table.

**Version**: 1.0.0 | **Ratified**: 2026-04-30 | **Last Amended**: 2026-04-30
