import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { InvestigationRequest, Environment, LinkingKey } from "../../models/index.js";
import type { Key } from "ink";
import type { InvestigationProfile } from "../services/InvestigationProfileService.js";

type FormField = "service" | "environment" | "linking-key" | "description";

const ENVIRONMENTS: Environment[] = ["prod", "dev"];
const FOCUS_ORDER: FormField[] = ["service", "environment", "linking-key", "description"];

interface InvestigationFormScreenProps {
  readonly onSubmit: (request: InvestigationRequest) => void;
  readonly profiles?: InvestigationProfile[];
  readonly initialProfile?: InvestigationProfile | null;
}

function submitForm(
  serviceId: string,
  environment: Environment,
  linkingKey: string,
  description: string,
  onSubmit: (r: InvestigationRequest) => void,
): void {
  if (!serviceId.trim()) return;
  const keys: LinkingKey[] = linkingKey.trim()
    ? [{ type: "http-correlation", value: linkingKey.trim() }]
    : [];
  onSubmit({
    serviceId: serviceId.trim(),
    environment,
    linkingKeys: keys,
    ...(description.trim() ? { observationDescription: description.trim() } : {}),
  });
}

function useFormInput(
  focusedField: FormField,
  setFocusedField: (fn: (f: FormField) => FormField) => void,
  envIndex: number,
  setEnvIndex: (fn: (i: number) => number) => void,
  profiles: InvestigationProfile[],
  profileIndex: number,
  setProfileIndex: (fn: (i: number) => number) => void,
  setServiceId: (v: string) => void,
  handleSubmit: () => void,
): void {
  useInput((_input, key) => {
    if (key.tab) {
      const idx = FOCUS_ORDER.indexOf(focusedField);
      setFocusedField(() => FOCUS_ORDER[(idx + 1) % FOCUS_ORDER.length] ?? "service");
      return;
    }
    if (focusedField === "environment") handleEnvKey(key, envIndex, setEnvIndex);
    if (key.return && focusedField === "description") handleSubmit();
    if (profiles.length > 0 && focusedField === "service") {
      handleProfileKey(key, profiles, profileIndex, setProfileIndex, setServiceId, setEnvIndex);
    }
  });
}

function handleEnvKey(key: Key, envIndex: number, setEnvIndex: (fn: (i: number) => number) => void): void {
  if (key.upArrow) setEnvIndex((i) => Math.max(0, i - 1));
  if (key.downArrow) setEnvIndex((i) => Math.min(ENVIRONMENTS.length - 1, i + 1));
}

function handleProfileKey(
  key: Key,
  profiles: InvestigationProfile[],
  profileIndex: number,
  setProfileIndex: (fn: (i: number) => number) => void,
  setServiceId: (v: string) => void,
  setEnvIndex: (fn: (i: number) => number) => void,
): void {
  if (key.upArrow) {
    setProfileIndex((i) => Math.max(-1, i - 1));
  }
  if (key.downArrow) {
    const nextIdx = Math.min(profiles.length - 1, profileIndex + 1);
    setProfileIndex(() => nextIdx);
    const p = profiles[nextIdx];
    if (p) {
      setServiceId(p.serviceId);
      const eIdx = ENVIRONMENTS.indexOf(p.environment);
      if (eIdx >= 0) setEnvIndex(() => eIdx);
    }
  }
}

// eslint-disable-next-line complexity
export function InvestigationFormScreen({
  onSubmit,
  profiles = [],
  initialProfile = null,
}: InvestigationFormScreenProps): React.JSX.Element {
  const [serviceId, setServiceId] = useState(initialProfile?.serviceId ?? "");
  const [envIndex, setEnvIndex] = useState<number>(() => {
    const idx = ENVIRONMENTS.indexOf(initialProfile?.environment ?? "prod");
    return idx >= 0 ? idx : 0;
  });
  const [linkingKey, setLinkingKey] = useState("");
  const [description, setDescription] = useState("");
  const [focusedField, setFocusedField] = useState<FormField>("service");
  const [profileIndex, setProfileIndex] = useState(-1);

  const environment = ENVIRONMENTS[envIndex] ?? "prod";

  const submit = (): void => {
    submitForm(serviceId, environment, linkingKey, description, onSubmit);
  };
  useFormInput(focusedField, setFocusedField, envIndex, setEnvIndex, profiles, profileIndex, setProfileIndex, setServiceId, submit);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">New Investigation</Text>
        <Text color="gray">Ctrl+S: settings  Ctrl+P: profiles</Text>
      </Box>
      <Text> </Text>

      <Box flexDirection="column" gap={1}>
        <Box>
          <Text color={focusedField === "service" ? "cyan" : "white"}>Service ID:   </Text>
          <TextInput
            value={serviceId}
            onChange={setServiceId}
            onSubmit={() => { setFocusedField("environment"); }}
            focus={focusedField === "service"}
            placeholder="e.g. order-service"
          />
        </Box>

        <Box flexDirection="column">
          <Text color={focusedField === "environment" ? "cyan" : "white"}>Environment:</Text>
          {ENVIRONMENTS.map((env, i) => (
            <Box key={env} marginLeft={2}>
              <Text color={i === envIndex ? "green" : "white"}>
                {focusedField === "environment" && i === envIndex ? "▶ " : "  "}
                {env}
              </Text>
            </Box>
          ))}
        </Box>

        <Box>
          <Text color={focusedField === "linking-key" ? "cyan" : "white"}>Linking Key:  </Text>
          <TextInput
            value={linkingKey}
            onChange={setLinkingKey}
            onSubmit={() => { setFocusedField("description"); }}
            focus={focusedField === "linking-key"}
            placeholder="optional: e.g. order:ord-12345"
          />
        </Box>

        <Box>
          <Text color={focusedField === "description" ? "cyan" : "white"}>Description:  </Text>
          <TextInput
            value={description}
            onChange={setDescription}
            onSubmit={submit}
            focus={focusedField === "description"}
            placeholder="optional: what are you seeing?"
          />
        </Box>
      </Box>

      <Text> </Text>
      <Text color="gray">Tab to move between fields, Enter on Description to start</Text>

      {profiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">Saved profiles (↑↓ when Service focused):</Text>
          {profiles.map((p, i) => (
            <Box key={p.id} marginLeft={2}>
              <Text color={i === profileIndex ? "green" : "gray"}>
                {i === profileIndex ? "▶ " : "  "}{p.name} ({p.serviceId}/{p.environment})
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
