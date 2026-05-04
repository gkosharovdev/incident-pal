import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useProfiles } from "../hooks/useProfiles.js";
import type { InvestigationProfile } from "../services/InvestigationProfileService.js";
import type { Environment } from "../../models/index.js";

type ProfilesMode = "list" | "create" | "confirm-delete";

const ENVIRONMENTS: Environment[] = ["prod", "dev"];

interface ProfilesScreenProps {
  readonly onBack: () => void;
  readonly onLoad?: (profile: InvestigationProfile) => void;
}

interface CreateFormState {
  name: string;
  serviceId: string;
  envIndex: number;
  linkingKey: string;
  field: "name" | "service" | "env" | "key";
  error: string | null;
}

function initialCreateForm(): CreateFormState {
  return { name: "", serviceId: "", envIndex: 0, linkingKey: "", field: "name", error: null };
}

export function ProfilesScreen({ onBack, onLoad }: ProfilesScreenProps): React.JSX.Element {
  const { profiles, error: profilesError, save, remove } = useProfiles();
  const [mode, setMode] = useState<ProfilesMode>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateFormState>(initialCreateForm);

  useInput((_input, key) => {
    if (mode === "list") handleListInput(_input, key);
    if (mode === "create") handleCreateInput(_input, key);
  });

  function handleListNavigation(key: import("ink").Key): void {
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex((i) => Math.min(profiles.length - 1, i + 1));
    if (key.return && onLoad) {
      const p = profiles[selectedIndex];
      if (p) onLoad(p);
    }
  }

  function handleListInput(input: string, key: import("ink").Key): void {
    if (key.escape) { onBack(); return; }
    if (input === "n") { setMode("create"); return; }
    if (input === "d") {
      const target = profiles[selectedIndex];
      if (target) { setDeleteTargetId(target.id); setMode("confirm-delete"); return; }
    }
    handleListNavigation(key);
  }

  function handleCreateInput(_input: string, key: import("ink").Key): void {
    if (key.escape) { setMode("list"); setForm(initialCreateForm()); return; }
    if (key.tab) {
      const order: CreateFormState["field"][] = ["name", "service", "env", "key"];
      const idx = order.indexOf(form.field);
      setForm((f) => ({ ...f, field: order[(idx + 1) % order.length] ?? "name" }));
    }
    if (form.field === "env") {
      if (key.upArrow) setForm((f) => ({ ...f, envIndex: Math.max(0, f.envIndex - 1) }));
      if (key.downArrow) setForm((f) => ({ ...f, envIndex: Math.min(ENVIRONMENTS.length - 1, f.envIndex + 1) }));
    }
    if (key.return && form.field === "key") handleCreate();
  }

  function handleCreate(): void {
    if (!form.name.trim() || !form.serviceId.trim()) {
      setForm((f) => ({ ...f, error: "Name and Service ID are required." }));
      return;
    }
    try {
      save({
        name: form.name.trim(),
        serviceId: form.serviceId.trim(),
        environment: ENVIRONMENTS[form.envIndex] ?? "prod",
        defaultLinkingKeyPrefix: form.linkingKey.trim() || null,
      });
      setMode("list");
      setForm(initialCreateForm());
    } catch (err) {
      setForm((f) => ({ ...f, error: String(err) }));
    }
  }

  if (mode === "confirm-delete") {
    const target = profiles.find((p) => p.id === deleteTargetId);
    return (
      <ConfirmDialog
        message={`Delete profile "${target?.name ?? deleteTargetId}"?`}
        onConfirm={() => { if (deleteTargetId) remove(deleteTargetId); setDeleteTargetId(null); setMode("list"); }}
        onCancel={() => { setDeleteTargetId(null); setMode("list"); }}
      />
    );
  }

  if (mode === "create") {
    return <CreateForm form={form} setForm={setForm} onSubmit={handleCreate} />;
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">Investigation Profiles</Text>
        <Text color="gray">Esc: back  N: new  D: delete  Enter: load</Text>
      </Box>
      <Text> </Text>
      {profilesError && <Text color="red">{profilesError}</Text>}
      {profiles.length === 0 ? (
        <Text color="gray">No profiles yet. Press N to create one.</Text>
      ) : (
        profiles.map((p, i) => (
          <Box key={p.id}>
            <Text color={i === selectedIndex ? "green" : "white"}>
              {i === selectedIndex ? "▶ " : "  "}
              {p.name}
            </Text>
            <Text color="gray"> ({p.serviceId} / {p.environment})</Text>
          </Box>
        ))
      )}
    </Box>
  );
}

function CreateForm({
  form,
  setForm,
  onSubmit,
}: {
  form: CreateFormState;
  setForm: React.Dispatch<React.SetStateAction<CreateFormState>>;
  onSubmit: () => void;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">New Profile</Text>
      <Text> </Text>
      <Box gap={1}>
        <Text color={form.field === "name" ? "cyan" : "white"}>Name:    </Text>
        <TextInput
          value={form.name}
          onChange={(v) => { setForm((f) => ({ ...f, name: v })); }}
          onSubmit={() => { setForm((f) => ({ ...f, field: "service" })); }}
          focus={form.field === "name"}
          placeholder="My Profile"
        />
      </Box>
      <Box gap={1}>
        <Text color={form.field === "service" ? "cyan" : "white"}>Service: </Text>
        <TextInput
          value={form.serviceId}
          onChange={(v) => { setForm((f) => ({ ...f, serviceId: v })); }}
          onSubmit={() => { setForm((f) => ({ ...f, field: "env" })); }}
          focus={form.field === "service"}
          placeholder="order-service"
        />
      </Box>
      <Box flexDirection="column">
        <Text color={form.field === "env" ? "cyan" : "white"}>Environment:</Text>
        {ENVIRONMENTS.map((env, i) => (
          <Box key={env} marginLeft={2}>
            <Text color={i === form.envIndex ? "green" : "white"}>
              {form.field === "env" && i === form.envIndex ? "▶ " : "  "}{env}
            </Text>
          </Box>
        ))}
      </Box>
      <Box gap={1}>
        <Text color={form.field === "key" ? "cyan" : "white"}>Key Prefix:</Text>
        <TextInput
          value={form.linkingKey}
          onChange={(v) => { setForm((f) => ({ ...f, linkingKey: v })); }}
          onSubmit={onSubmit}
          focus={form.field === "key"}
          placeholder="optional (e.g. order)"
        />
      </Box>
      {form.error && <Text color="red">{form.error}</Text>}
      <Text> </Text>
      <Text color="gray">Tab: next field, Enter on Key Prefix: save, Esc: cancel</Text>
    </Box>
  );
}
