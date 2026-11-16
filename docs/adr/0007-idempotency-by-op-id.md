# 0007. Idempotency by `opId`

- Status: Accepted
- Date: 2026-11-12

## Context

On unreliable networks, the client cannot tell whether an operation arrived when the response is
lost. The only safe client strategy is to **resend**, and the server must make the resend harmless
(R6 to R8). The brief also asks to tell a legitimate resend (same content) apart from an `opId`
reused with different content.

## Decision

- The `opId` is an **idempotency key**, the same pattern as Stripe's API and the IETF draft for the
  `Idempotency-Key` header. In *Enterprise Integration Patterns* terms, the server is an
  *Idempotent Receiver*, and the `opId` returned in each result is a *Correlation Identifier*.
- The client generates the `opId` **when the edit is saved**, not when it is sent, so every resend
  reuses it ([ADR 0011](0011-web-client.md)).
- The first **valid** operation with an `opId` stores its content and result in the **same commit**
  that applies the effect ([ADR 0006](0006-transaction-per-operation.md)). This includes conflicts
  (R6).
- Uniqueness is a **conditional write in the port**: `insertReceipt` only writes if the `opId` is
  free, inside the transaction, and returns `false` otherwise. With two simultaneous requests, only
  one can write. In a database, a primary key on `op_id` would provide this.
- **"Same content"** means exact equality of `noteId`, `baseRevision` and `text`. The `opId` is the
  key, not the content.
  - The comparison is field by field, with exact string equality, **without normalizing**
    whitespace, case or Unicode. Normalizing would treat as "equal" texts the person wrote
    differently.
- Nothing is stored for an invalid operation (R5) or for `id_reused` (it is not a new operation, and
  the original receipt still stands).

## Alternatives considered

- **Compare a content hash (SHA-256)**: saves space with large payloads. But the text must be stored
  anyway to build the receipt, so a hash would be an extra field with no gain, plus
  canonicalization rules.
- **Check, then write, outside the transaction**: leaves a race window between the check and the
  write. Two simultaneous requests would apply the same operation twice.
- **Key scoped per client** (`(client_id, op_id)`, like Stripe does per account): the right choice in
  a system with authentication. There is no client identity here, so the scope is global.

## Consequences

- **Positive**: resending an operation or a batch is safe, even with copies arriving at the same time
  (scenario C1 in the spec). Resending until there is a response gives *at-least-once* delivery, and
  the idempotent receiver turns it into an *effectively-once* effect.
- **Negative**: receipts grow with every valid operation. Global uniqueness of the `opId` depends on
  the client generating collision-free ids (UUID v4 or v7).
- **Limits**:
  - **Retention**: in production, receipts would expire after a while (Stripe uses 24 hours), and the
    client contract would say "do not resend after X". A resend after expiry would be processed as
    a new operation and would most likely return `conflict`. Not implemented.
  - Without authentication, one client can "take" another client's `opId`s. A per-client scope fixes
    that.
