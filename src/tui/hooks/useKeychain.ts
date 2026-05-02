import { useState, useCallback } from "react";
import { KeychainService, KeychainUnavailableError } from "../services/KeychainService.js";
import type { CredentialConfig } from "../services/KeychainService.js";

interface UseKeychainResult {
  readonly credentials: CredentialConfig | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly save: (config: CredentialConfig) => Promise<void>;
}

const defaultService = new KeychainService();

export function useKeychain(service: KeychainService = defaultService): UseKeychainResult {
  const [credentials, setCredentials] = useState<CredentialConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (config: CredentialConfig) => {
      setLoading(true);
      setError(null);
      try {
        await service.saveCredentials(config);
        setCredentials(config);
      } catch (err) {
        const msg = err instanceof KeychainUnavailableError ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [service],
  );

  return { credentials, loading, error, save };
}
