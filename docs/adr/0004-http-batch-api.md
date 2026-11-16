# 0004. HTTP API with a batch endpoint (`POST /sync`)

- Status: Accepted
- Date: 2026-11-12

## Context

The brief describes a **queue** of operations accumulated offline. It is processed in the order
received, with one result per operation, and an error does not stop the following ones (R9). The
brief does not require HTTP, but a real API makes the demo and the web simulator more concrete.

## Decision

| Method | Route | Response |
|---|---|---|
| `POST` | `/sync` | Body `{ operations: [...] }` → `200 { results: [...] }`, same order and same length. |
| `GET` | `/notes/:id` | `200` with the current note (R10), or `404`. |
| `GET` | `/operations/:opId` | `200` with the stored receipt, or `404`. Useful for debugging and demos. |

- **`200` even when operations fail**: errors are **per operation**, inside `results`. Non-`200`
  codes are reserved for when the batch itself is malformed:
  - `400`: invalid envelope (for example, `operations` is not a list);
  - `413`: more than 100 operations;
  - `5xx`: infrastructure failure, in which case the client resends the whole batch.
- **camelCase JSON** (`opId`, `noteId`, `baseRevision`): it is the type inferred from the Zod schema,
  used without conversion in the core, the API and the web app. If a database uses snake_case, the
  conversion stays inside its adapter.

## Alternatives considered

- **One request per operation**, with `PUT /notes/:id`, `If-Match` (ETag) and an `Idempotency-Key`
  header: the most idiomatic REST shape, but a poor fit for an offline queue. It means N round trips,
  and the order of parallel requests is not guaranteed unless the client serializes them. It remains
  a natural evolution for online edits.
- **`207 Multi-Status`**: semantically appealing, but it comes from WebDAV and has little client
  support. Elasticsearch's bulk API returns `200` with per-item errors, a well-known precedent.
- **snake_case JSON**, like the brief: easier side-by-side comparison, but it forces snake_case
  TypeScript types or a conversion layer at the HTTP edge.
- **tRPC or GraphQL**: tRPC couples the client to TypeScript and hides the HTTP semantics this
  project wants to discuss. GraphQL adds a schema, resolvers and tooling with no gain for three
  endpoints.

## Consequences

- **Positive**: resending the whole batch after a lost response is **safe by construction**, because
  each operation is idempotent ([ADR 0007](0007-idempotency-by-op-id.md)). That is why idempotency
  exists. The batch endpoint is also a *Remote Facade* (Fowler): ten offline edits become one round
  trip instead of ten.
- **Negative**: the HTTP status does not say whether the operations succeeded, so the client must
  inspect each result. Monitoring that counts errors by HTTP status does not see conflicts.
- **Limits**: no authentication and no rate limiting. The batch is processed sequentially, so latency
  grows with batch size, hence the limit of 100.
