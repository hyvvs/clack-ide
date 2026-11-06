/** Acceptance-harness policy only. A single ForgeBoard mission still permits
 * its conditional, same-session 50 -> 25 correction. `singleSpec` prevents
 * separate missions, not the correction observer. */
export function shouldObserveForgeBoardCorrection(input: {
  phase: "mission-a" | "resume-a";
  singleSpec: boolean;
  alreadyCorrected: boolean;
  correcting: boolean;
  harnessStopped: boolean;
}): boolean {
  return !input.alreadyCorrected && !input.correcting && !input.harnessStopped;
}
