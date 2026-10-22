export interface SafeFailure {
  failureStage: string;
  failureCode: string;
  failureClass: string;
  failureOwner: string;
  nativeDispatchAttempted: boolean;
  lastDurableStage: string;
}
export function classifyR5hFailure(
  error: unknown, stage: string, lastDurableStage: string, nativeDispatchAttempted: boolean
): SafeFailure;
