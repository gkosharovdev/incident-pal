import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Environment } from "../../models/index.js";

export interface InvestigationProfile {
  readonly id: string;
  readonly name: string;
  readonly serviceId: string;
  readonly environment: Environment;
  readonly defaultLinkingKeyPrefix: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const DEFAULT_CONFIG_DIR = join(homedir(), ".incident-pal");

export class InvestigationProfileService {
  private readonly configDir: string;
  private readonly profilesPath: string;

  constructor(configDir: string = DEFAULT_CONFIG_DIR) {
    this.configDir = configDir;
    this.profilesPath = join(configDir, "profiles.json");
  }

  list(): InvestigationProfile[] {
    try {
      const raw = readFileSync(this.profilesPath, "utf-8");
      return JSON.parse(raw) as InvestigationProfile[];
    } catch {
      return [];
    }
  }

  save(profile: Omit<InvestigationProfile, "id" | "createdAt" | "updatedAt"> & { id?: string }): InvestigationProfile {
    const profiles = this.list();
    const now = new Date().toISOString();
    const existing = profile.id ? profiles.find((p) => p.id === profile.id) : null;

    const duplicate = profiles.find(
      (p) => p.name === profile.name && p.id !== (profile.id ?? null),
    );
    if (duplicate) {
      throw new Error(`A profile named "${profile.name}" already exists.`);
    }

    const saved: InvestigationProfile = {
      id: profile.id ?? randomUUID(),
      name: profile.name,
      serviceId: profile.serviceId,
      environment: profile.environment,
      defaultLinkingKeyPrefix: profile.defaultLinkingKeyPrefix ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const updated = existing
      ? profiles.map((p) => (p.id === saved.id ? saved : p))
      : [...profiles, saved];

    this.writeAtomic(updated);
    return saved;
  }

  delete(id: string): void {
    const profiles = this.list().filter((p) => p.id !== id);
    this.writeAtomic(profiles);
  }

  private writeAtomic(profiles: InvestigationProfile[]): void {
    mkdirSync(this.configDir, { recursive: true });
    const tmp = `${this.profilesPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(profiles, null, 2), "utf-8");
    writeFileSync(this.profilesPath, readFileSync(tmp, "utf-8"), "utf-8");
  }
}
