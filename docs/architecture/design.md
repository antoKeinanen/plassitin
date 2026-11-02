# Table seating architecture

## Problem

Build a table assignment organizer inside the existing TanStack Start shell. Natural language interpretation is uncertain; constraints and scores must be reproducible. This release is a local single-organizer workspace with one npm-managed runtime.

## Usage (caller's view)

```ts
const interpreted = await interpretPreferences({ data: { personId, text, attendees } })
// Review or explicitly ignore unknown references before generating.
const result = await optimizeSeating({ data: event })
if (result.kind === 'plan') renderTables(result.assignments)
```

## Shape

- `model.ts` owns validated domain schemas, deduplication, observed satisfaction, and independent plan validation.
- `preferences.ts` owns exact registry resolution and conservative reference-list parsing.
- `actions.ts` exposes validated server functions. `engine.server.ts` owns the optional extraction HTTP adapter; `solver.server.ts` owns optimization request lifecycle and result validation.
- `optimizer.ts` compiles validated event snapshots into a binary linear model with numeric variable names. `workers/optimizer.mjs` runs the npm-managed HiGHS WebAssembly library in an isolated Node worker.
- `workspace.tsx` owns the browser-persisted event document and discards responses when their input snapshot changed.

Unresolved, resolved, and ignored clauses are separate variants. Only resolved nonempty target sets enter search. A positive ANY clause earns one reward; an avoidance ANY clause is violated if any target shares the table. Preferences remain directed. Targets must exist and cannot refer to the author. Duplicate clauses collapse before optimization and reporting.

All modes first minimize occupied tables, then maximize completely full tables, subject to capacities, locks, and mandatory separations. Binary used/full variables are tied to each table’s load; each packing optimum is frozen before preference objectives.

Each attendee gets an integer budget of 1000 positive points and 1000 avoidance points, distributed proportionally to clause weights using largest remainders. Balanced solves avoidance, companion coverage, and normalized positive satisfaction in strict order. Fairness inserts minimum positive satisfaction after avoidance. Raw weighted preferences is an explicitly separate mode. A stage is frozen only after HiGHS proves its optimum with zero relative and absolute MIP gap. Search stops on a time limit and returns the last valid incumbent as feasible. No incumbent means timeout; proven impossibility means infeasible.

The mathematical model assigns every person exactly one table, enforces capacities, locks, and mandatory separation. Clause/table witness variables encode ANY directly without rewards proportional to group size. Interchangeable unlocked tables use first-appearance symmetry constraints. Model size is bounded before expensive relationship allocation. A native search deadline and outer worker deadline limit each call. Every returned plan passes an independent domain evaluator before the UI sees it.

## Synthesis decision

The architecture was reconsidered when the user required a single language toolchain. The revised arena compared HiGHS WebAssembly with custom TypeScript bounded search. HiGHS wins because it provides mature mathematical optimization and proof statuses without an external runtime. Graft the other candidate's explicit timeout versus infeasibility distinction and immutable per-call state. Keep the current UI and storage owners.

The cross-judge selected HiGHS. The worker remains a separate checked-in JavaScript runtime asset; run the built web server from the repository root and include workers and installed dependencies in deployment. Browser bundles contain no solver runtime or extraction secrets.

## Tradeoffs accepted

- Accept a WebAssembly dependency in exchange for exact mixed-integer optimization.
- Keep browser-local fallback with no database setup. Full state now lives in compressed base64url fragments; see [URL state design](url-state/design.md).
- Accept manual reference review without an AI endpoint in exchange for useful simple lists without invented identities.
- Accept table assignment only; chair adjacency and unsupported descriptions stay unresolved.

## Alternatives considered

A custom TypeScript search removes the solver package but makes search quality and proof correctness application responsibilities. A separate service adds another process and API lifecycle. Browser-only WebAssembly complicates asset loading and keeps extraction on the server anyway.

## Open questions and risks

Exact chair refinement now follows table assignment; see [seat preferences](seat-preferences.md). Remote attendee collection remains outside the current scope. Events near schema limits may exceed the practical relationship budget and receive a clear size error.

## Next implementation step

Verify the exact optimizer on exhaustive small examples and exercise a real production-server solve, then finish UI verification.

## Visual direction

The current interface is specified in [the split editor revision](split-editor.md). The map and three-column attendee grid replace the previous dashboard. Shared code memberships and explicit name links are translated into directed ANY clauses before optimization.

## Shared tags

The active editor supports direct person chips and shared tag membership. A tag produces one directed preference toward each other member with that tag; the optimizer's usual normalization, packing priorities, capacities and hard rules still apply. Tags are soft preferences, so an oversized group can split. There is no independent “anyone from” request or group-reference search mode. Preference messages remain inert reference text.

The editor schema consumes retired manual-reference fields and from-style constraints only as migration input, converts them to ordinary tag membership, and omits the old field from new documents/URLs. Name-only reference resolution remains available for older person chips. New search options are restricted by type to person or tag.

The current named-preference policy gives names a stronger, separate influence budget than tags, with each request scaled by the requester’s distinct choices. Narrow named lists therefore receive stronger individual matches; repeating a request does not create extra weight. Named-companion optimization precedes tag coverage in Balanced/Fairness, while packing and mandatory rules remain prior constraints.
