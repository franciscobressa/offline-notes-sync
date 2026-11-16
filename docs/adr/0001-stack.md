# 0001. Stack: TypeScript, Node.js 24 and npm workspaces

- Status: Accepted
- Date: 2026-11-12

## Context

The role asks for TypeScript, Next.js and NestJS. The solution has a front end, a back end and a
domain shared by both: the domain types (operation, note, result) show up in all three parts. The
three packages (`core`, `api`, `web`) share code and are versioned together, and reviewers need to
install and run everything with a few commands.

## Decision

- **TypeScript everywhere**, with `strict: true` and `noUncheckedIndexedAccess: true`.
- **TypeScript pinned to `~5.9`.** `npm install` first brought TypeScript 7.0.2, the compiler
  rewritten in Go. Its package no longer ships `lib/typescript.js`, the classic JavaScript compiler
  API, and only exposes the binary plus an API marked `unstable`. typescript-eslint, the type check
  in `next build` and the NestJS tooling all depend on the classic API.
- **Node.js 24 LTS** as the runtime, pinned in `.nvmrc` and in `engines`.
- **npm workspaces** for the monorepo. It ships with Node, so there is nothing extra to install.
- **No task orchestrator** (Turborepo or Nx). Root scripts use `npm run <script> --workspaces` and
  `--workspace <package>`.

## Alternatives considered

- **Plain JavaScript**: less configuration, but it loses the check that every result status is
  handled ([ADR 0008](0008-data-contract.md)), one of the most useful guarantees in this domain.
- **Bun or Deno**: faster, with native TypeScript. But NestJS and Next.js are more mature and better
  tested on Node, and reviewers most likely already have Node installed.
- **Another back-end language** (Go, Kotlin): advantages in concurrency and performance, but outside
  the role's stack, and types could not be shared with the front end.
- **TypeScript 7 in the core and 5.9 elsewhere**: the core would compile faster, but the repository
  would have two compilers with potentially different diagnostics.
- **pnpm workspaces**: faster and stricter, because it blocks importing an undeclared dependency
  (*phantom dependency*). Not chosen because reviewers would need an extra step (`corepack enable`),
  and the gain is small with three packages.
- **Turborepo**: build cache and task pipeline. With three packages the build takes seconds, so the
  cache does not pay for the setup. It runs on top of npm workspaces and can be added later.
- **Nx**: too heavy and opinionated for this size.
- **Polyrepo**: core changes would require publishing versions, and reviewers would clone three
  repositories.

## Consequences

- **Positive**: one type system from the core to the UI. Discriminated unions with an exhaustiveness
  check (`never`) make the compiler flag any forgotten status. `npm install` at the root installs
  everything.
- **Negative**:
  - Types do not exist at runtime, so network data needs explicit validation
    ([ADR 0008](0008-data-contract.md)).
  - Type checking is slower than with TypeScript 7. At this size, the difference is seconds.
  - npm hoists dependencies to the root, so a package can import something it did not declare and
    work by accident. The `import-x/no-extraneous-dependencies` lint rule flags that.
- **Limits**: no task cache and no automatic check of package boundaries. Revisit if CI gets slow,
  the number of packages grows, or typescript-eslint, Next.js and NestJS support TypeScript 7.
