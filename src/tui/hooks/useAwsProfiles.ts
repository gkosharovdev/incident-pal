import { useState, useEffect } from "react";
import { AwsProfileService } from "../services/AwsProfileService.js";

interface UseAwsProfilesResult {
  readonly profiles: string[];
  readonly loading: boolean;
  readonly error: string | null;
}

const defaultService = new AwsProfileService();

export function useAwsProfiles(service: AwsProfileService = defaultService): UseAwsProfilesResult {
  const [profiles, setProfiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    service.listProfiles().then((list) => {
      setProfiles(list);
    }).catch((err: unknown) => {
      setError(String(err));
    }).finally(() => {
      setLoading(false);
    });
  }, [service]);

  return { profiles, loading, error };
}
