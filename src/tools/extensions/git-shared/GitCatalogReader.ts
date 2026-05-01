import { readFileSync } from "node:fs";
import yaml from "js-yaml";

interface GitServiceEntry {
  id: string;
  repositoryUrl?: string;
}

interface GitCatalog {
  services: GitServiceEntry[];
}

export interface RepoCoords {
  owner: string;
  repo: string;
}

export class GitCatalogReader {
  private readonly catalog: GitCatalog;

  constructor(catalogPath: string) {
    const raw = readFileSync(catalogPath, "utf-8");
    this.catalog = yaml.load(raw) as GitCatalog;
  }

  resolve(serviceId: string): RepoCoords | null {
    const service = this.catalog.services.find((s) => s.id === serviceId);
    if (!service?.repositoryUrl) return null;
    return parseGitHubUrl(service.repositoryUrl);
  }
}

function parseGitHubUrl(url: string): RepoCoords | null {
  const match = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?/.exec(url);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}
