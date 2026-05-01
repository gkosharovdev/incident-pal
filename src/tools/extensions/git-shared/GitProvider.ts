export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: string;
  parentShas: string[];
  files: FileDiff[];
}

export interface FileDiff {
  filePath: string;
  previousPath: string | null;
  changeType: "added" | "modified" | "deleted" | "renamed";
  unifiedDiff: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface FileContent {
  filePath: string;
  sha: string;
  content: string;
  sizeBytes: number;
}

export interface VersionComparison {
  baseSha: string;
  headSha: string;
  files: FileDiff[];
  totalFilesChanged: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  status: "ahead" | "behind" | "diverged" | "identical";
}

export interface SymbolMatch {
  filePath: string;
  lineNumber: number;
  matchContext: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

export class GitProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "GitProviderError";
  }
}

export interface GitProvider {
  getCommit(owner: string, repo: string, ref: string): Promise<CommitInfo>;
  getFileContent(
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
  ): Promise<FileContent>;
  compareCommits(
    owner: string,
    repo: string,
    baseRef: string,
    headRef: string,
  ): Promise<VersionComparison>;
  searchSymbol(
    owner: string,
    repo: string,
    symbol: string,
  ): Promise<SymbolMatch[]>;
  listDirectory(
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<DirectoryEntry[]>;
}
