// Transient guards only; durable intent and receipts live on PeerTask records.
export const peerWaitingSessions = new Set<string>();
export const peerReplySessions = new Set<string>();
