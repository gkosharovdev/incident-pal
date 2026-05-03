import keytar from "keytar";

const KEYCHAIN_SERVICE = "incident-pal";
const ACCOUNT_API_KEY = "anthropic-api-key";
const ACCOUNT_AWS_PROFILE = "aws-profile";

export interface CredentialConfig {
  readonly anthropicApiKey: string;
  readonly awsProfile: string;
}

export class KeychainUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`OS keychain is unavailable: ${String(cause)}`);
    this.name = "KeychainUnavailableError";
  }
}

export class KeychainService {
  async isAvailable(): Promise<boolean> {
    try {
      await keytar.getPassword(KEYCHAIN_SERVICE, "__probe__");
      return true;
    } catch {
      return false;
    }
  }

  async getCredentials(): Promise<CredentialConfig | null> {
    try {
      const [apiKey, awsProfile] = await Promise.all([
        keytar.getPassword(KEYCHAIN_SERVICE, ACCOUNT_API_KEY),
        keytar.getPassword(KEYCHAIN_SERVICE, ACCOUNT_AWS_PROFILE),
      ]);
      if (!apiKey || !awsProfile) return null;
      return { anthropicApiKey: apiKey, awsProfile };
    } catch (err) {
      throw new KeychainUnavailableError(err);
    }
  }

  async saveCredentials(config: CredentialConfig): Promise<void> {
    try {
      await Promise.all([
        keytar.setPassword(KEYCHAIN_SERVICE, ACCOUNT_API_KEY, config.anthropicApiKey),
        keytar.setPassword(KEYCHAIN_SERVICE, ACCOUNT_AWS_PROFILE, config.awsProfile),
      ]);
    } catch (err) {
      throw new KeychainUnavailableError(err);
    }
  }
}
