import type { JSONSchema7 } from "../../../models/JSONSchema.js";
import type { Tool, ToolResult } from "../../../models/Tool.js";
import { GitCatalogReader } from "../git-shared/GitCatalogReader.js";
import {
  GitProviderError,
  type GitProvider,
} from "../git-shared/GitProvider.js";

export interface DocumentationFile {
  filePath: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

export interface RepoDocumentationResult {
  files: DocumentationFile[];
  scannedPaths: string[];
  missingPaths: string[];
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 204_800;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const NO_REPO_CONFIGURED = "NO_REPO_CONFIGURED";

const WELL_KNOWN_DOC_FILES = ["README.md", "AGENTS.md"] as const;
const WELL_KNOWN_DOC_DIRS = [".specify", "adr", "docs/adr"] as const;

const INPUT_SCHEMA: JSONSchema7 = {
  type: "object",
  properties: {
    serviceId: {
      type: "string",
      description: "Service ID from the service catalog",
    },
  },
  required: ["serviceId"],
  additionalProperties: false,
};

interface RepoDocumentationInput {
  serviceId: string;
}

export class RepoDocumentationTool implements Tool {
  readonly name = "repo-documentation";
  readonly description =
    "Read architecture and business documentation from a service repository (README, AGENTS.md, ADRs, .specify files)";
  readonly inputSchema: JSONSchema7 = INPUT_SCHEMA;

  private readonly catalogReader: GitCatalogReader;
  private readonly maxFileSizeBytes: number;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly provider: GitProvider,
    catalogPath: string,
    options?: {
      maxFileSizeBytes?: number;
      requestTimeoutMs?: number;
    },
  ) {
    this.catalogReader = new GitCatalogReader(catalogPath);
    this.maxFileSizeBytes =
      options?.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    this.requestTimeoutMs =
      options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async invoke(input: unknown): Promise<ToolResult> {
    const typed = input as RepoDocumentationInput;

    const coords = this.catalogReader.resolve(typed.serviceId);
    if (!coords) {
      return errorResult(
        `${NO_REPO_CONFIGURED}: no repositoryUrl configured for service "${typed.serviceId}"`,
      );
    }

    const { owner, repo } = coords;
    const files: DocumentationFile[] = [];
    const scannedPaths: string[] = [];
    const missingPaths: string[] = [];

    try {
      for (const filePath of WELL_KNOWN_DOC_FILES) {
        scannedPaths.push(filePath);
        const doc = await this.fetchFile(owner, repo, "HEAD", filePath);
        if (doc !== null) {
          files.push(doc);
        } else {
          missingPaths.push(filePath);
        }
      }

      for (const dirPath of WELL_KNOWN_DOC_DIRS) {
        scannedPaths.push(dirPath);
        const dirFiles = await this.fetchDirectory(owner, repo, dirPath);
        if (dirFiles === null) {
          missingPaths.push(dirPath);
        } else {
          files.push(...dirFiles);
        }
      }

      const data: RepoDocumentationResult = { files, scannedPaths, missingPaths };
      return { success: true, data, error: null };
    } catch (err) {
      if (err instanceof GitProviderError) {
        return errorResult(err.message);
      }
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  }

  private async fetchFile(
    owner: string,
    repo: string,
    ref: string,
    filePath: string,
  ): Promise<DocumentationFile | null> {
    try {
      const fileContent = await withTimeout(
        this.provider.getFileContent(owner, repo, ref, filePath),
        this.requestTimeoutMs,
      );

      let content = fileContent.content;
      let truncated = false;
      if (Buffer.byteLength(content, "utf-8") > this.maxFileSizeBytes) {
        content = Buffer.from(content, "utf-8")
          .subarray(0, this.maxFileSizeBytes)
          .toString("utf-8");
        truncated = true;
      }

      return {
        filePath: fileContent.filePath,
        content,
        sizeBytes: fileContent.sizeBytes,
        truncated,
      };
    } catch (err) {
      if (err instanceof GitProviderError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  private async fetchDirectory(
    owner: string,
    repo: string,
    dirPath: string,
  ): Promise<DocumentationFile[] | null> {
    try {
      const entries = await withTimeout(
        this.provider.listDirectory(owner, repo, "HEAD", dirPath),
        this.requestTimeoutMs,
      );

      const docs: DocumentationFile[] = [];
      for (const entry of entries) {
        if (entry.type !== "file") continue;
        const doc = await this.fetchFile(owner, repo, "HEAD", entry.path);
        if (doc !== null) {
          docs.push(doc);
        }
      }
      return docs;
    } catch (err) {
      if (err instanceof GitProviderError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }
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
