import { create } from "zustand";
type Job = { profileId: string; controller: AbortController; context?: number };
export const useContextCalibrationJobs = create<{ jobs: Record<string, Job> }>(
  () => ({ jobs: {} }),
);
