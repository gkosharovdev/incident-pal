# Feature Specification: TUI Agent Monitor

**Feature Branch**: `004-tui-agent-monitor`
**Created**: 2026-05-01
**Status**: Draft
**Input**: User description: "TUI for the incident-pal agent so that it is easier for a human user to configure and monitor the agent event stream in a similar fashion to claude code or opencode for example"

## Clarifications

### Session 2026-05-01

- Q: How should the TUI persist credentials locally? → A: OS keychain (macOS Keychain / Linux Secret Service) — never written to disk as plaintext.
- Q: What AWS credential entry method should the TUI support? → A: Named profile selector — lists profiles from `~/.aws/credentials`; user picks one by name.
- Q: How should the system detect headless/CI mode? → A: Automatic TTY detection (no TTY attached = headless) plus an explicit `--headless` CLI flag that forces headless mode regardless of TTY state.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start an Investigation via TUI (Priority: P1)

A developer or on-call engineer launches the TUI from their terminal and is presented with an interactive form to fill in the investigation parameters (service name, environment, at least one linking key, and optionally a time window). Once submitted, the agent starts and the screen transitions to the live event stream view.

**Why this priority**: This is the primary entry point. Without a usable configuration form, the TUI delivers no value. All other stories depend on the agent being started.

**Independent Test**: Can be fully tested by launching the TUI, completing the form, and verifying the agent starts and the stream view appears — delivers a complete, working investigation session with no other stories required.

**Acceptance Scenarios**:

1. **Given** the user launches the TUI, **When** the configuration form is displayed, **Then** they can enter service name, environment, and at least one linking key using keyboard navigation between fields.
2. **Given** the user has filled all required fields, **When** they submit the form, **Then** the investigation begins and the display transitions to the live event stream panel.
3. **Given** the user leaves a required field blank, **When** they attempt to submit, **Then** the form highlights the missing field with an error message and does not start the agent.
4. **Given** the user wants to provide an optional time window, **When** they enter start/end times, **Then** those values are passed to the investigation request; if omitted, the 60-minute default is applied automatically.

---

### User Story 2 - First-Launch Credential Setup (Priority: P1)

When a user launches the TUI for the first time (or when credentials are absent from the OS keychain), a setup wizard guides them through entering an Anthropic API key and selecting an AWS profile. The wizard must be completable before any investigation can be started. After initial setup, users can return to the settings screen at any time to change these values.

**Why this priority**: Without valid credentials the agent cannot run at all. The first-launch experience is the gate between installation and first use; a poor experience here blocks every downstream story.

**Independent Test**: Can be fully tested by launching the TUI with no credentials in the keychain, completing the wizard, and verifying that the credentials are retrievable and the investigation form is then reachable — without needing any investigation to actually run.

**Acceptance Scenarios**:

1. **Given** the TUI is launched and no credentials exist in the OS keychain, **When** the application starts, **Then** the credential setup wizard is shown before any other screen.
2. **Given** the setup wizard is displayed, **When** the user enters an Anthropic API key (masked input) and selects an AWS profile from the list of available profiles in `~/.aws/credentials`, **Then** the values are stored in the OS keychain and the wizard exits to the investigation form.
3. **Given** credentials are already stored, **When** the user navigates to the Settings screen, **Then** they can update the Anthropic API key or change the selected AWS profile, and the new values replace the previous entries in the keychain.
4. **Given** no AWS profiles exist in `~/.aws/credentials`, **When** the profile selector is shown, **Then** the user sees an informative message explaining how to create a profile, and the selector is empty rather than crashing.
5. **Given** the user clears the Anthropic API key field and attempts to save, **When** the save action is triggered, **Then** an error is shown and the save is rejected — the keychain entry is not overwritten with an empty value.

---

### User Story 3 - Monitor the Live Event Stream (Priority: P1)

While the agent is running, the TUI displays each trace event as it is emitted — tool invocations, tool results, linking key discoveries, budget updates, and timeout warnings — in a scrollable, timestamped log panel similar to how Claude Code streams agent thinking and tool use to the terminal.

**Why this priority**: Real-time visibility into the agent's reasoning is the core value proposition of the TUI. Without it, the TUI is no better than piping output to a file.

**Independent Test**: Can be tested by running an investigation with mock/recorded fixtures and verifying that each expected trace event type appears in the stream panel in the correct order with correct labels and timestamps.

**Acceptance Scenarios**:

1. **Given** the agent invokes a tool, **When** the tool call is dispatched, **Then** a new entry appears in the stream panel showing the tool name and key inputs within one second of the call being made.
2. **Given** a tool call completes, **When** the result is recorded, **Then** the stream panel appends a result entry showing success/failure status and a summary of the output.
3. **Given** a new linking key is discovered from a log query, **When** the key is added to the active set, **Then** a highlighted "key discovered" entry appears in the stream with the key type and value.
4. **Given** the stream has more entries than fit on screen, **When** the user scrolls up, **Then** the panel allows reviewing historical entries without pausing the live stream at the bottom.
5. **Given** the investigation is still running, **When** the scan budget reaches 80% utilisation, **Then** a visible warning indicator appears in the status bar.

---

### User Story 4 - View the Completed Investigation Report (Priority: P2)

When the agent finishes (either successfully, timed-out, or budget-exhausted), the TUI presents the full Markdown investigation report in a dedicated panel. The user can scroll through it, and optionally save it to a file, without leaving the TUI.

**Why this priority**: Delivering the report within the same TUI session completes the investigation workflow. Without it, users must hunt for the report file separately, which undermines the UX goal.

**Independent Test**: Can be tested independently by pre-loading a completed investigation result and verifying the report panel renders the Markdown content correctly with scrolling enabled.

**Acceptance Scenarios**:

1. **Given** the agent completes an investigation, **When** the report is ready, **Then** the TUI transitions to (or adds) a report panel displaying the full Markdown content with sections clearly readable in the terminal.
2. **Given** the report is longer than the visible area, **When** the user scrolls, **Then** they can navigate the entire report with keyboard controls.
3. **Given** the user wants to save the report, **When** they press the designated save shortcut, **Then** the report is written to a file in the current directory and the TUI shows a confirmation message with the file path.
4. **Given** the investigation ended due to a timeout or budget exhaustion, **When** the report panel is shown, **Then** a clearly visible status banner explains why the investigation stopped before the report content is displayed.

---

### User Story 5 - Configure Investigation Profiles (Priority: P3)

A power user wants to avoid re-typing the same service name, environment, and common linking-key prefixes for every investigation. The TUI supports named profiles that pre-populate the configuration form, and allows creating or updating a profile from a completed form before starting an investigation.

**Why this priority**: Quality-of-life improvement for frequent users. The TUI is fully useful without profiles; they reduce repetitive input in high-volume on-call contexts.

**Independent Test**: Can be tested independently by creating a profile, restarting the TUI, and verifying the profile pre-populates the form fields correctly.

**Acceptance Scenarios**:

1. **Given** the configuration form is displayed, **When** the user selects a previously saved profile, **Then** the form fields are populated with the profile's values, which the user can still edit before starting.
2. **Given** the user has filled in the form, **When** they choose to save it as a profile with a name, **Then** the profile is persisted and available the next time the TUI is launched.
3. **Given** a profile exists, **When** the user deletes it, **Then** it is removed from the profile list and no longer appears in the selector.

---

### Edge Cases

- What happens when the agent emits events faster than the TUI can render them? Events must be buffered and displayed without dropping entries; the TUI should not slow the agent down.
- What happens if the terminal is resized during an active investigation? The layout should reflow gracefully without losing stream content or corrupting the display.
- What happens when the TUI is launched in a terminal that is too narrow or too short to render the layout? A minimum dimensions warning is shown and the user is prompted to resize before proceeding.
- What happens if the user presses Ctrl-C during an investigation? The TUI prompts for confirmation before aborting to prevent accidental interruption of a running investigation.
- What happens when a linking-key value is very long? Values are truncated with an ellipsis in the stream view, and the full value is accessible via a detail expand shortcut.
- What happens when the OS keychain is unavailable (e.g., locked, missing daemon)? The TUI displays a clear error explaining the keychain is inaccessible and instructs the user to set credentials via environment variables as a fallback.
- What happens when the TUI is launched headless (no TTY or `--headless` flag) but required credentials are absent from env vars? The process exits with a non-zero status code and a descriptive error message — no interactive prompts are shown.
- What happens when `~/.aws/credentials` exists but contains no profiles? The profile selector shows an informative empty state with instructions for creating an AWS profile.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an interactive configuration form that accepts service name, environment, one or more linking keys, and an optional time window before starting an investigation.
- **FR-002**: The system MUST display each agent trace event in a scrollable live stream panel as events are emitted, with a timestamp and event-type label for each entry.
- **FR-003**: The stream panel MUST surface all trace entry types defined by the agent: tool-call, tool-result, tool-error, linking-key-discovered, result-truncated, budget-exhausted, and timed-out.
- **FR-004**: The system MUST display a persistent status bar showing at minimum: investigation elapsed time, current scan budget utilisation, number of completed iterations, and overall investigation status.
- **FR-005**: The system MUST render the full investigation report in a dedicated panel when the agent finishes, with keyboard-navigable scrolling.
- **FR-006**: Users MUST be able to save the investigation report to a file on disk from within the TUI using a keyboard shortcut.
- **FR-007**: The system MUST allow the user to scroll back through past stream events without interrupting or pausing the live feed.
- **FR-008**: The system MUST prompt for confirmation before aborting an in-progress investigation.
- **FR-009**: The TUI MUST support keyboard-only operation — no mouse interaction required for any feature.
- **FR-010**: The system MUST display a warning when terminal dimensions are below the minimum required to render the layout correctly.
- **FR-011**: The system MUST support named investigation profiles that persist across sessions, allowing users to save and recall common configuration sets.
- **FR-012**: All TUI interactions MUST be strictly read-only with respect to production systems — the TUI does not add any write paths beyond local file saves (report export, profiles, credential storage in the OS keychain).
- **FR-013**: On first launch (or when credentials are absent from the OS keychain), the system MUST present a credential setup wizard before allowing any investigation to start.
- **FR-014**: The credential setup wizard MUST accept a masked Anthropic API key input and a selectable AWS profile name (populated from `~/.aws/credentials`), and store both values in the OS keychain.
- **FR-015**: The system MUST provide a Settings screen, accessible at any time via a keyboard shortcut, where the user can update the stored Anthropic API key or change the selected AWS profile.
- **FR-016**: In headless mode (no TTY attached or `--headless` CLI flag provided), the system MUST bypass all interactive setup and credential prompts, reading credentials exclusively from environment variables (`ANTHROPIC_API_KEY`, `AWS_PROFILE`).
- **FR-017**: When running headless and required environment variables are absent, the system MUST exit with a non-zero status code and a descriptive error message.
- **FR-018**: When the OS keychain is unavailable, the system MUST display a clear error message and instruct the user to supply credentials via environment variables as a fallback.

### Key Entities

- **InvestigationRequest**: Represents the user-supplied configuration that launches an investigation — service name, environment, linking keys, time window.
- **StreamEntry**: A single displayable event in the live stream panel — type label, timestamp, summary text, and optional detail payload for expand view.
- **InvestigationProfile**: A named, persisted set of InvestigationRequest defaults — name, service name, environment, optional default linking-key prefix.
- **ReportDocument**: The completed investigation report as rendered Markdown, associated with a status (complete, timed-out, budget-exhausted) and the investigation ID.
- **CredentialConfig**: The set of credentials required to run the agent — Anthropic API key (stored as a keychain secret) and AWS profile name (stored as a keychain secret). Never written to disk as plaintext. In headless mode, sourced from environment variables instead.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can progress from TUI launch to an active investigation in under 60 seconds without consulting documentation (excluding first-launch credential setup, which is a one-time step).
- **SC-002**: Every trace event emitted by the agent appears in the stream panel within 1 second of being recorded.
- **SC-003**: The TUI remains responsive (no input lag above 100ms) even when the agent emits bursts of 50 or more events within a single second.
- **SC-004**: 90% of new users in usability testing can locate and read the final investigation report without assistance.
- **SC-005**: Saving the investigation report to a file completes in under 2 seconds for reports up to 500 KB.
- **SC-006**: The TUI layout correctly reflows and remains usable within 500ms of a terminal resize event.
- **SC-007**: A new user completes the first-launch credential setup wizard in under 2 minutes without consulting documentation.

---

## Assumptions

- The TUI is used in terminal environments that support at least 256-colour ANSI escape codes; plain-text fallback for non-colour terminals is out of scope for v1.
- The agent is invoked in-process by the TUI — the TUI and agent run in the same Node.js process, so event streaming is via an event emitter or observable, not inter-process communication.
- Investigation profiles are stored as local JSON files in a well-known config directory (e.g., `~/.incident-pal/`); no remote or shared profile storage is required for v1.
- The TUI targets the same LTS Node.js version as the rest of the project and is implemented in TypeScript, consistent with the project's language standards.
- Mouse support is not required; the TUI is fully operable via keyboard navigation and standard terminal shortcuts.
- The minimum supported terminal size is 80 columns × 24 rows — the TUI warns but does not block at smaller sizes.
- The agent's existing `Trace` and event model are the source of truth for stream entries; the TUI subscribes to events and does not alter the agent's internal event flow.
- The OS keychain is available on the developer's workstation (macOS Keychain on Mac, a compatible Secret Service implementation on Linux). CI/CD environments are assumed to use the `--headless` flag or lack a TTY, and supply credentials via environment variables.
- AWS credentials are managed externally via the AWS CLI (`aws configure`) — the TUI reads existing named profiles from `~/.aws/credentials` but does not create or modify that file.
- The environment variables used in headless mode are `ANTHROPIC_API_KEY` and `AWS_PROFILE`; these are the canonical names and are not configurable.
