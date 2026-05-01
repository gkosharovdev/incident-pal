import type { Octokit } from "@octokit/rest";
import {
  GitProviderError,
  type CommitInfo,
  type DirectoryEntry,
  type FileDiff,
  type FileContent,
  type GitProvider,
  type SymbolMatch,
  type VersionComparison,
} from "./GitProvider.js";

export class GitHubProvider implements GitProvider {
  constructor(private readonly octokit: Octokit) {}

  async getCommit(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<CommitInfo> {
    try {
      const { data } = await this.octokit.repos.getCommit({
        owner,
        repo,
        ref,
        mediaType: { format: "diff" },
      });

      const files: FileDiff[] = (data.files ?? []).map((f) =>
        mapFileDiff(f),
      );

      const commit = data.commit;
      const sha = data.sha;
      return {
        sha,
        shortSha: sha.slice(0, 7),
        message: commit.message,
        authorName: commit.author?.name ?? "",
        authorEmail: commit.author?.email ?? "",
        timestamp: commit.author?.date ?? "",
        parentShas: data.parents.map((p) => p.sha),
        files,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async getFileContent(
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
  ): Promise<FileContent> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
        ref,
      });

      if (Array.isArray(data) || data.type !== "file") {
        throw new GitProviderError(`Path is not a file: ${filePath}`, 400);
      }

      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return {
        filePath: data.path,
        sha: data.sha,
        content,
        sizeBytes: data.size,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async compareCommits(
    owner: string,
    repo: string,
    baseRef: string,
    headRef: string,
  ): Promise<VersionComparison> {
    try {
      const { data } = await this.octokit.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${baseRef}...${headRef}`,
      });

      const files: FileDiff[] = (data.files ?? []).map((f) => mapFileDiff(f));

      const totalLinesAdded = files.reduce((sum, f) => sum + f.linesAdded, 0);
      const totalLinesRemoved = files.reduce(
        (sum, f) => sum + f.linesRemoved,
        0,
      );

      return {
        baseSha: data.merge_base_commit.sha,
        headSha: data.commits[data.commits.length - 1]?.sha ?? headRef,
        files,
        totalFilesChanged: files.length,
        totalLinesAdded,
        totalLinesRemoved,
        status: data.status,
      };
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async searchSymbol(
    owner: string,
    repo: string,
    symbol: string,
  ): Promise<SymbolMatch[]> {
    try {
      const { data } = await this.octokit.search.code({
        q: `${symbol} repo:${owner}/${repo}`,
        per_page: 100,
      });

      const matches: SymbolMatch[] = [];
      for (const item of data.items) {
        const lines = item.text_matches ?? [];
        for (const match of lines) {
          const lineNumber = extractLineNumber(match.fragment ?? "");
          matches.push({
            filePath: item.path,
            lineNumber,
            matchContext: match.fragment ?? "",
          });
        }
        if (lines.length === 0) {
          matches.push({
            filePath: item.path,
            lineNumber: 0,
            matchContext: "",
          });
        }
      }
      return matches;
    } catch (err) {
      throw toProviderError(err);
    }
  }

  async listDirectory(
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<DirectoryEntry[]> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (!Array.isArray(data)) {
        throw new GitProviderError(`Path is not a directory: ${path}`, 400);
      }

      return data.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type === "dir" ? "dir" : "file",
      }));
    } catch (err) {
      throw toProviderError(err);
    }
  }
}

type OctokitFileEntry = {
  filename?: string;
  previous_filename?: string;
  status?: string;
  patch?: string;
  additions?: number;
  deletions?: number;
};

function mapFileDiff(f: OctokitFileEntry): FileDiff {
  const changeType = mapStatus(f.status ?? "modified");
  const filePath =
    changeType === "deleted"
      ? (f.filename ?? "")
      : (f.filename ?? "");
  return {
    filePath: filePath,
    previousPath: f.previous_filename ?? null,
    changeType,
    unifiedDiff: f.patch ?? "",
    linesAdded: f.additions ?? 0,
    linesRemoved: f.deletions ?? 0,
  };
}

function mapStatus(
  status: string,
): "added" | "modified" | "deleted" | "renamed" {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "modified";
  }
}

function extractLineNumber(fragment: string): number {
  const lines = fragment.split("\n");
  return lines.length > 0 ? 1 : 0;
}

function toProviderError(err: unknown): GitProviderError {
  if (err instanceof GitProviderError) return err;
  if (err != null && typeof err === "object" && "status" in err) {
    const status = err.status;
    if (typeof status === "number") {
      const msg =
        "message" in err && typeof err.message === "string"
          ? err.message
          : `GitHub API error ${status}`;
      return new GitProviderError(msg, status);
    }
  }
  const msg =
    err instanceof Error ? err.message : "Unknown git provider error";
  return new GitProviderError(msg);
}
