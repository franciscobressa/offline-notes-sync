/** Current server state of a note (R1). */
export interface Note {
  readonly id: string;
  readonly text: string;
  readonly revision: number;
}

/** A change sent by a client, already validated (R5). */
export interface Operation {
  readonly opId: string;
  readonly noteId: string;
  readonly baseRevision: number;
  readonly text: string;
}

/** What the client asked for, echoed back on conflict (R4). */
export type Proposal = Pick<Operation, 'noteId' | 'baseRevision' | 'text'>;

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface Created {
  readonly opId: string;
  readonly status: 'created';
  readonly note: Note;
}

export interface Updated {
  readonly opId: string;
  readonly status: 'updated';
  readonly note: Note;
}

export interface Conflict {
  readonly opId: string;
  readonly status: 'conflict';
  /** `null` means the note does not exist on the server. */
  readonly server: Note | null;
  readonly proposal: Proposal;
}

export interface Invalid {
  /** `null` when the input has no usable `opId`. */
  readonly opId: string | null;
  readonly status: 'invalid';
  readonly errors: readonly ValidationIssue[];
}

export interface IdReused {
  readonly opId: string;
  readonly status: 'id_reused';
}

/** Results that are persisted as receipts (R6). Invalid and id_reused are never stored. */
export type RecordedResult = Created | Updated | Conflict;

/** A receipt returned again for a resent operation (R7, A9). */
export type Replayed = RecordedResult & { readonly replayed: true };

/** Exactly one per operation in a batch (R9). See ADR 0008. */
export type OperationResult = RecordedResult | Replayed | Invalid | IdReused;

/** The stored proof of what happened the first time an operation was processed (R6). */
export interface Receipt {
  readonly operation: Operation;
  readonly result: RecordedResult;
}

/**
 * What the shell must do with an operation. Produced by `decide()`, which never
 * performs it (ADR 0003).
 */
export type Decision =
  | { readonly kind: 'replay'; readonly result: Replayed }
  | { readonly kind: 'reject'; readonly result: IdReused }
  | { readonly kind: 'create'; readonly note: Note; readonly receipt: Receipt }
  | {
      readonly kind: 'update';
      readonly note: Note;
      readonly expectedRevision: number;
      readonly receipt: Receipt;
    }
  | { readonly kind: 'conflict'; readonly receipt: Receipt };
