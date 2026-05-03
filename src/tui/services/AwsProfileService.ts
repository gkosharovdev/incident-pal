import { parseKnownFiles } from "@aws-sdk/shared-ini-file-loader";

export class AwsProfileService {
  async listProfiles(): Promise<string[]> {
    try {
      const parsed = await parseKnownFiles({});
      return Object.keys(parsed);
    } catch {
      return [];
    }
  }
}
