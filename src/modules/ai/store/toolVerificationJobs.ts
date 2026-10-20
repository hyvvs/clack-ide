import { create } from "zustand";
export const useToolVerificationJobs = create<{
  jobs: Record<string, { profileId: string; controller: AbortController }>;
}>(() => ({ jobs: {} }));
