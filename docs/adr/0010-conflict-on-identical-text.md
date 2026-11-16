# 0010. Identical text on a stale base is still a conflict

- Status: Accepted
- Date: 2026-11-12

## Context

Someone edited from revision 1, but the server is already at revision 2. By coincidence, the text
they send is **identical** to revision 2. Should it be a conflict?

The brief answers from both ends:

- "When the base revision does not match the expected one, return `conflict`" (R4);
- "increase the revision by 1, even if the text sent is the same as before" (R3).

So the rule is defined **only by the revision**, never by the text.

## Decision

- **On the server, it is still a conflict.** `decide()` does not compare texts to settle conflicts.
- **On the client** (the simulator), a conflict where `proposal.text === server.text` is settled
  without asking: the client adopts the server revision as its new base and drops the pending
  operation. It sends nothing, because the note is already what the person wanted.

## Alternatives considered

- **The server accepting identical text** (as a no-op success, or by increasing the revision):
  - it contradicts R4, which is defined by the revision;
  - it is a form of automatic resolution, which the brief forbids;
  - it invites more exceptions: what if only a space changes? Or letter case? The rule no longer
    fits in one line;
  - equal texts do not mean the same intent, because the person never saw revision 2.
- **A dedicated status** (for example, `conflict_identical`): useful information, but the client can
  already infer it by comparing the two texts in the result. A new status would add a case to every
  caller without adding information.

## Consequences

- **Positive**: the server rule stays trivial and auditable. The user experience does not suffer,
  because the client hides the trivial conflict.
- **Negative**: a `conflict` receipt is stored even when "there was no real conflict". Conflict-rate
  metrics include these trivial cases.
- **Limits**: if trivial conflicts are frequent in real use (for example, two devices applying the
  same autocorrection), measure before changing the server rule.
