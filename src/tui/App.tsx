import React, { useState, useEffect } from "react";
import { Text, Box, useInput } from "ink";
import type { Key } from "ink";
import type { InvestigationRequest, Investigation } from "../models/index.js";
import type { CredentialConfig } from "./services/KeychainService.js";
import { KeychainService, KeychainUnavailableError } from "./services/KeychainService.js";
import { SetupWizardScreen } from "./screens/SetupWizardScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { InvestigationFormScreen } from "./screens/InvestigationFormScreen.js";
import { StreamViewScreen } from "./screens/StreamViewScreen.js";
import { ReportViewScreen } from "./screens/ReportViewScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { useKeychain } from "./hooks/useKeychain.js";
import { useInvestigation } from "./hooks/useInvestigation.js";
import { useProfiles } from "./hooks/useProfiles.js";

export type ScreenState =
  | "checking-credentials"
  | "keychain-error"
  | "setup-wizard"
  | "investigation-form"
  | "stream-view"
  | "report-view"
  | "settings"
  | "profiles";

export interface AppState {
  screen: ScreenState;
  priorScreen: "investigation-form" | "report-view" | null;
  credentials: CredentialConfig | null;
  request: InvestigationRequest | null;
  investigation: Investigation | null;
  keychainError: string | null;
}

export type AppTransition = (update: Partial<AppState>) => void;

interface AppProps {
  readonly keychainService?: KeychainService;
}

const defaultKeychain = new KeychainService();

// SC-006: Ink v7 subscribes to SIGWINCH internally and re-renders the Yoga
// layout tree on resize. No explicit handler is needed here.
export default function App({ keychainService = defaultKeychain }: AppProps): React.ReactElement {
  const [state, setState] = useState<AppState>({
    screen: "checking-credentials",
    priorScreen: null,
    credentials: null,
    request: null,
    investigation: null,
    keychainError: null,
  });

  const transition: AppTransition = (update) => {
    setState((prev) => ({ ...prev, ...update }));
  };

  useEffect(() => {
    if (state.screen !== "checking-credentials") return;
    void (async (): Promise<void> => {
      const available = await keychainService.isAvailable();
      if (!available) {
        transition({ screen: "keychain-error", keychainError: "OS keychain is unavailable" });
        return;
      }
      try {
        const creds = await keychainService.getCredentials();
        if (creds === null) {
          transition({ screen: "setup-wizard" });
        } else {
          transition({ screen: "investigation-form", credentials: creds });
        }
      } catch (err) {
        if (err instanceof KeychainUnavailableError) {
          transition({ screen: "keychain-error", keychainError: err.message });
        } else {
          transition({ screen: "keychain-error", keychainError: String(err) });
        }
      }
    })();
  }, [state.screen, keychainService]);

  return <AppScreens state={state} transition={transition} keychainService={keychainService} />;
}

interface AppScreensProps {
  state: AppState;
  transition: AppTransition;
  keychainService: KeychainService;
}

function AppScreens({ state, transition, keychainService }: AppScreensProps): React.ReactElement {
  const { save: saveCredentials, loading: saving, error: saveError } = useKeychain(keychainService);
  const investigation = useInvestigation();
  const { profiles } = useProfiles();

  useInput((input, key) => {
    handleGlobalShortcut(input, key, state, transition);
  });

  return renderScreen(state, transition, saving, saveError, saveCredentials, investigation, profiles);
}

function handleGlobalShortcut(
  input: string,
  key: Key,
  state: AppState,
  transition: AppTransition,
): void {
  const blocked: ScreenState[] = ["checking-credentials", "keychain-error", "setup-wizard"];
  if (blocked.includes(state.screen)) return;

  if (key.ctrl && input === "s" && state.screen !== "settings") {
    const prior = state.screen === "investigation-form" || state.screen === "report-view"
      ? state.screen
      : state.priorScreen;
    transition({ screen: "settings", priorScreen: prior });
  }
  if (key.ctrl && input === "p" && state.screen === "investigation-form") {
    transition({ screen: "profiles", priorScreen: "investigation-form" });
  }
}

function renderScreen(
  state: AppState,
  transition: AppTransition,
  saving: boolean,
  saveError: string | null,
  saveCredentials: (config: CredentialConfig) => Promise<void>,
  investigation: ReturnType<typeof useInvestigation>,
  profiles: ReturnType<typeof useProfiles>["profiles"],
): React.ReactElement {
  switch (state.screen) {
    case "checking-credentials":
      return <Text dimColor>Checking credentials…</Text>;
    case "keychain-error":
      return renderKeychainError(state.keychainError);
    case "setup-wizard":
      return renderSetupWizard(transition, saving, saveError, saveCredentials);
    case "settings":
      return renderSettings(state, transition, saving, saveError, saveCredentials);
    case "investigation-form":
      return renderInvestigationForm(state, transition, investigation.start, profiles);
    case "stream-view":
      return renderStreamView(state, transition, investigation);
    case "report-view":
      return renderReportView(state, transition);
    case "profiles":
      return renderProfiles(state, transition);
    default:
      return <Text color="red">Unknown screen: {state.screen as string}</Text>;
  }
}

function renderKeychainError(keychainError: string | null): React.ReactElement {
  return (
    <Box flexDirection="column" gap={1}>
      <Text color="red" bold>OS Keychain Unavailable</Text>
      <Text>{keychainError ?? "Keychain access failed."}</Text>
      <Text dimColor>
        Set <Text color="yellow">ANTHROPIC_API_KEY</Text> and{" "}
        <Text color="yellow">AWS_PROFILE</Text> environment variables and restart.
      </Text>
    </Box>
  );
}

function renderSetupWizard(
  transition: AppTransition,
  saving: boolean,
  saveError: string | null,
  saveCredentials: (config: CredentialConfig) => Promise<void>,
): React.ReactElement {
  return (
    <SetupWizardScreen
      saving={saving}
      saveError={saveError}
      onComplete={(config) => {
        void saveCredentials(config).then(() => {
          transition({ screen: "investigation-form", credentials: config });
        });
      }}
    />
  );
}

function renderSettings(
  state: AppState,
  transition: AppTransition,
  saving: boolean,
  saveError: string | null,
  saveCredentials: (config: CredentialConfig) => Promise<void>,
): React.ReactElement {
  const backTo = state.priorScreen ?? "investigation-form";
  return (
    <SettingsScreen
      currentCredentials={state.credentials}
      saving={saving}
      saveError={saveError}
      onSave={async (config) => {
        await saveCredentials(config);
        transition({ screen: backTo, credentials: config });
      }}
      onBack={() => { transition({ screen: backTo }); }}
    />
  );
}

function renderInvestigationForm(
  state: AppState,
  transition: AppTransition,
  start: ReturnType<typeof useInvestigation>["start"],
  profiles: ReturnType<typeof useProfiles>["profiles"],
): React.ReactElement {
  return (
    <InvestigationFormScreen
      profiles={profiles}
      onSubmit={(request) => {
        if (!state.credentials) return;
        transition({ screen: "stream-view", request });
        start(request, state.credentials);
      }}
    />
  );
}

function renderStreamView(
  state: AppState,
  transition: AppTransition,
  inv: ReturnType<typeof useInvestigation>,
): React.ReactElement {
  return (
    <StreamViewScreen
      entries={inv.entries}
      status={inv.status}
      iteration={inv.iteration}
      elapsedMs={inv.elapsedMs}
      budgetPct={inv.budgetPct}
      investigation={inv.investigation}
      error={inv.error}
      onViewReport={(result) => { transition({ screen: "report-view", investigation: result }); }}
      onNewInvestigation={() => { transition({ screen: "investigation-form", investigation: null }); }}
    />
  );
}

function renderReportView(state: AppState, transition: AppTransition): React.ReactElement {
  if (!state.investigation) {
    return <Text color="red">No investigation result available.</Text>;
  }
  return (
    <ReportViewScreen
      investigation={state.investigation}
      onNewInvestigation={() => { transition({ screen: "investigation-form", investigation: null }); }}
      onBackToStream={() => { transition({ screen: "stream-view" }); }}
    />
  );
}

function renderProfiles(state: AppState, transition: AppTransition): React.ReactElement {
  return (
    <ProfilesScreen
      onBack={() => { transition({ screen: state.priorScreen ?? "investigation-form" }); }}
      onLoad={() => { transition({ screen: "investigation-form", priorScreen: null }); }}
    />
  );
}
