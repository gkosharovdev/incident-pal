import type { JSONSchema7 } from "../../../models/JSONSchema.js";
import type { Tool, ToolResult } from "../../../models/Tool.js";
import { GitCatalogReader } from "../git-shared/GitCatalogReader.js";
import {
  GitProviderError,
  type CommitInfo,
  type FileDiff,
  type FileContent,
  type GitProvider,
  type SymbolMatch,
  type VersionComparison,
} from "../git-shared/GitProvider.js";

const DEFAULT_MAX_DIFF_BYTES = 512_000;
const DEFAULT_MAX_SYMBOL_RESULTS = 50;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const NO_REPO_CONFIGURED = "NO_REPO_CONFIGURED";
const INVALID_REF_ORDER = "INVALID_REF_ORDER";

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    operation: {
      type: "string",
      enum: ["get-commit", "get-file", "compare", "search-symbol"],
      description: "Which retrieval operation to perform",
    },
    serviceId: {
      type: "string",
      description: "Service ID from the service catalog",
    },
    ref: {
      type: "string",
      description:
        "Commit SHA, tag, or branch — required for get-commit, get-file, search-symbol",
    },
    filePath: {
      type: "string",
      description: "File path within the repo — required for get-file",
    },
    baseRef: {
      type: "string",
      description: "Base commit/tag — required for compare",
    },
    headRef: {
      type: "string",
      description: "Head commit/tag — required for compare",
    },
    symbol: {
      type: "string",
      description:
        "Method, class, or identifier to search for — required for search-symbol",
    },
  },
  required: ["operation", "serviceId"],
  additionalProperties: false,
};

interface GitCodeRetrievalInput {
  operation: "get-commit" | "get-file" | "compare" | "search-symbol";
  serviceId: string;
  ref?: string;
  filePath?: string;
  baseRef?: string;
  headRef?: string;
  symbol?: string;
}

export class GitCodeRetrievalTool implements Tool {
  readonly name = "git-code-retrieval";
  readonly description =
    "Retrieve code from a git repository: commit diff, file content, version comparison, or symbol search";
  readonly inputSchema: JSONSchema7 = INPUT_SCHEMA;

  private readonly catalogReader: GitCatalogReader;
  private readonly maxDiffBytes: number;
  private readonly maxSymbolResults: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly provider: GitProvider,
    catalogPath: string,
    options?: {
      maxDiffBytes?: number;
      maxSymbolResults?: number;
      requestTimeoutMs?: number;
    },
  ) {
    this.catalogReader = new GitCatalogReader(catalogPath);
    this.maxDiffBytes = options?.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;
    this.maxSymbolResults =
      options?.maxSymbolResults ?? DEFAULT_MAX_SYMBOL_RESULTS;
    this.requestTimeoutMs =
      options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const typed = input as GitCodeRetrievalInput;

    const coords = this.catalogReader.resolve(typed.serviceId);
    if (!coords) {
      return errorResult(
        `${NO_REPO_CONFIGURED}: no repositoryUrl configured for service "${typed.serviceId}"`,
      );
    }

    try {
      switch (typed.operation) {
        case "get-commit":
          return await this.handleGetCommit(typed, coords.owner, coords.repo);
        case "get-file":
          return await this.handleGetFile(typed, coords.owner, coords.repo);
        case "compare":
          return await this.handleCompare(typed, coords.owner, coords.repo);
        case "search-symbol":
          return await this.handleSearchSymbol(
            typed,
            coords.owner,
            coords.repo,
          );
        default:
          return errorResult(`Unknown operation: ${String(typed.operation)}`);
      }
    } catch (err) {
      if (err instanceof GitProviderError) {
        return errorResult(err.message);
      }
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }

  private async handleGetCommit(
    input: GitCodeRetrievalInput,
    owner: string,
    repo: string,
  ): Promise<ToolResult> {
    if (!input.ref) {
      return errorResult('Missing required field "ref" for get-commit operation');
    }

    const commit = await withTimeout(
      this.provider.getCommit(owner, repo, input.ref),
      this.requestTimeoutMs,
    );

    const { files, truncated } = applyDiffCap(commit.files, this.maxDiffBytes);
    const data: CommitInfo = { ...commit, files };

    return { success: true, data, error: null, truncated };
  }

  private async handleGetFile(
    input: GitCodeRetrievalInput,
    owner: string,
    repo: string,
  ): Promise<ToolResult> {
    if (!input.ref) {
      return errorResult('Missing required field "ref" for get-file operation');
    }
    if (!input.filePath) {
      return errorResult(
        'Missing required field "filePath" for get-file operation',
      );
    }

    const fileContent = await withTimeout(
      this.provider.getFileContent(owner, repo, input.ref, input.filePath),
      this.requestTimeoutMs,
    );

    const maxBytes = DEFAULT_MAX_DIFF_BYTES;
    let content = fileContent.content;
    let truncated = false;
    if (Buffer.byteLength(content, "utf-8") > maxBytes) {
      content = Buffer.from(content, "utf-8")
        .subarray(0, maxBytes)
        .toString("utf-8");
      truncated = true;
    }

    const data: FileContent = { ...fileContent, content };
    return { success: true, data, error: null, truncated };
  }

  private async handleCompare(
    input: GitCodeRetrievalInput,
    owner: string,
    repo: string,
  ): Promise<ToolResult> {
    if (!input.baseRef) {
      return errorResult(
        'Missing required field "baseRef" for compare operation',
      );
    }
    if (!input.headRef) {
      return errorResult(
        'Missing required field "headRef" for compare operation',
      );
    }

    const comparison = await withTimeout(
      this.provider.compareCommits(owner, repo, input.baseRef, input.headRef),
      this.requestTimeoutMs,
    );

    if (comparison.status === "behind" || comparison.status === "diverged") {
      return errorResult(
        `${INVALID_REF_ORDER}: baseRef must be an ancestor of headRef. Got status: ${comparison.status}`,
      );
    }

    const { files, truncated } = applyDiffCap(
      comparison.files,
      this.maxDiffBytes,
    );
    const totalLinesAdded = files.reduce((sum, f) => sum + f.linesAdded, 0);
    const totalLinesRemoved = files.reduce(
      (sum, f) => sum + f.linesRemoved,
      0,
    );

    const data: VersionComparison = {
      ...comparison,
      files,
      totalFilesChanged: files.length,
      totalLinesAdded,
      totalLinesRemoved,
    };

    return { success: true, data, error: null, truncated };
  }

  private async handleSearchSymbol(
    input: GitCodeRetrievalInput,
    owner: string,
    repo: string,
  ): Promise<ToolResult> {
    if (!input.symbol) {
      return errorResult(
        'Missing required field "symbol" for search-symbol operation',
      );
    }

    const matches = await withTimeout(
      this.provider.searchSymbol(owner, repo, input.symbol),
      this.requestTimeoutMs,
    );

    const truncated = matches.length > this.maxSymbolResults;
    const capped: SymbolMatch[] = matches.slice(0, this.maxSymbolResults);

    return {
      success: true,
      data: { matches: capped, totalCount: matches.length },
      error: null,
      truncated,
    };
  }
}

function applyDiffCap(
  files: FileDiff[],
  maxBytes: number,
): { files: FileDiff[]; truncated: boolean } {
  let bytesUsed = 0;
  const result: FileDiff[] = [];
  let truncated = false;

  for (const file of files) {
    const diffBytes = Buffer.byteLength(file.unifiedDiff, "utf-8");
    if (bytesUsed + diffBytes > maxBytes) {
      result.push({ ...file, unifiedDiff: "[diff truncated — byte cap reached]" });
      truncated = true;
    } else {
      result.push(file);
      bytesUsed += diffBytes;
    }
  }

  return { files: result, truncated };
}

function errorResult(message: string): ToolResult {
  return { success: false, data: null, error: message };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GitProviderError(`Request timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
