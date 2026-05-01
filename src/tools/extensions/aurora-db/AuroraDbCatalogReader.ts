import { readFileSync } from "node:fs";
import yaml from "js-yaml";

export interface AuroraDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  region: string;
  credentialSource: "iam" | "env-var";
  envPasswordVar?: string;
}

interface AuroraServiceEntry {
  id: string;
  auroraDatabase?: Record<string, AuroraDatabaseConfig>;
}

interface AuroraCatalog {
  services: AuroraServiceEntry[];
}

export class AuroraDbCatalogReader {
  private readonly catalog: AuroraCatalog;

  constructor(catalogPath: string) {
    const raw = readFileSync(catalogPath, "utf-8");
    this.catalog = yaml.load(raw) as AuroraCatalog;
  }

  resolve(serviceId: string, environment: string): AuroraDatabaseConfig | null {
    const service = this.catalog.services.find((s) => s.id === serviceId);
    if (!service?.auroraDatabase) return null;
    return service.auroraDatabase[environment] ?? null;
  }
}
