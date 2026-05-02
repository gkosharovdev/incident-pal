import { useState, useCallback } from "react";
import { InvestigationProfileService } from "../services/InvestigationProfileService.js";
import type { InvestigationProfile } from "../services/InvestigationProfileService.js";

interface UseProfilesResult {
  readonly profiles: InvestigationProfile[];
  readonly error: string | null;
  readonly save: (profile: Omit<InvestigationProfile, "id" | "createdAt" | "updatedAt"> & { id?: string }) => void;
  readonly remove: (id: string) => void;
  readonly reload: () => void;
}

const defaultService = new InvestigationProfileService();

export function useProfiles(service: InvestigationProfileService = defaultService): UseProfilesResult {
  const [profiles, setProfiles] = useState<InvestigationProfile[]>(() => service.list());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setProfiles(service.list());
  }, [service]);

  const save = useCallback(
    (profile: Omit<InvestigationProfile, "id" | "createdAt" | "updatedAt"> & { id?: string }) => {
      try {
        service.save(profile);
        setProfiles(service.list());
        setError(null);
      } catch (err) {
        setError(String(err));
      }
    },
    [service],
  );

  const remove = useCallback(
    (id: string) => {
      try {
        service.delete(id);
        setProfiles(service.list());
        setError(null);
      } catch (err) {
        setError(String(err));
      }
    },
    [service],
  );

  return { profiles, error, save, remove, reload };
}
