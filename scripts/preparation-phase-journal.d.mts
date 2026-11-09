/** Type surface for the node-only, opt-in acceptance evidence journal. */
export type PhaseRow = Readonly<{
  schemaVersion: 1;
  sequence: number;
  at: number;
  sessionId: string;
  runId: string;
  phase: string;
  nativeRequestId?: string;
}>;
export type CaptureReceipt = Readonly<{
  emitted: number;
  acknowledged: number;
  overflow: number;
  deliveryFailed: boolean;
}>;
export type JournalReceipt = Readonly<{
  schemaVersion: 1;
  claim: 'collector-flush-only';
  count: number;
  sha256: string;
}>;
export function validatePreparationPhaseRow(record: unknown, expectedSequence: number): PhaseRow;
export function createPreparationPhaseJournal(filename: string, maxRecords?: number): Promise<{
  append(record: PhaseRow): Promise<number>;
  seal(receipt: CaptureReceipt): Promise<JournalReceipt>;
  abandon(): Promise<void>;
}>;
/** Pass byte-for-byte journal content read from disk; parsed rows alone do not
 * establish persisted integrity and are always interpreted as incomplete. */
export function interpretPreparationPhaseRows(rows: readonly PhaseRow[], receipt?: JournalReceipt | null, rawJournal?: Uint8Array): Readonly<{
  collectorCoverage: 'collector-flushed' | 'partial-or-unsealed';
  nativeSdkOrdering: 'unknown' | 'native-terminal-before-sdk-json' | 'sdk-json-before-native-terminal';
  requestOrderings: readonly Readonly<{
    nativeRequestId: string;
    ordering: 'unknown' | 'native-terminal-before-sdk-json' | 'sdk-json-before-native-terminal';
  }>[];
  nativeRequestsLinked: number;
  extractorDeadlineObserved: boolean;
  agentTerminalObserved: boolean;
  inferenceProgress: 'not-established';
  forgeBoardAcceptance: 'not-evaluated';
}>;
