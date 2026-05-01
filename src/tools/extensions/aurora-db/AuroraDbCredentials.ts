import { Signer } from "@aws-sdk/rds-signer";
import type { AuroraDatabaseConfig } from "./AuroraDbCatalogReader.js";

export async function resolvePassword(config: AuroraDatabaseConfig): Promise<string> {
  if (config.credentialSource === "iam") {
    const signer = new Signer({
      hostname: config.host,
      port: config.port,
      region: config.region,
      username: config.username,
    });
    return signer.getAuthToken();
  }

  const varName = config.envPasswordVar ?? "";
  const password = process.env[varName];
  if (!password) {
    throw new Error(
      `CREDENTIAL_ERROR: Environment variable '${varName}' is not set (credentialSource: env-var)`,
    );
  }
  return password;
}
