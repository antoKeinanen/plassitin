# Candidate B after scrap: native TypeScript search

## Grounding

The working app already has a good narrow seam: workspace.tsx calls optimizeSeating in actions.ts; engine.server.ts currently starts the external solver. model.ts owns validated events, resolved ANY clauses, deduplication and independent evaluatePlan. The workspace owns browser-local persistence, exports, manual moves, locks, and snapshot invalidation. preferences.ts keeps extraction separate from registry matching. Preserve those owners. Remove the external runtime entirely and replace the solver behind the existing seam with native TypeScript; no external interpreter files, setup scripts, dependencies, documentation instructions or hidden fallback remain.

## Usage first

```ts
// Existing organizer call site remains unchanged.
const result = await optimizeSeating({ data: eventSnapshot })
if (result.kind === 'plan') showPlan(result)

// Pure domain entry used by server and tests.
const result = await solveSeating({ event, deadlineMs: 8_000 })
if (result.kind === 'plan') {
  const report = evaluatePlan(event, result.assignments)
  // The entry point already performs this independent verification.
  if (report.violations.length) throw new Error('Invalid solver result')
}
```

## Module/type sketch

```
model.ts          validated event/result variants, canonical objective comparator,
                  independent assignment evaluation
solver.ts         native search: compilation, feasible seed, improvement, exact DFS
engine.server.ts  interpretation endpoint and solver boundary
actions.ts        existing server function validation
workspace.tsx     existing organizer UI and browser persistence
```

```ts
type SearchInput = Readonly<{
  event: SeatingEvent
  deadlineMs: number
}>

// Derived from Zod schemas. Existing public discriminants can remain intact.
type SolveResult =
  | { kind: 'plan'; status: 'optimal' | 'feasible'; assignments: Record<string, string>; seconds: number }
  | { kind: 'infeasible' | 'timeout'; message: string }

// Internal arrays indexed by compiled person/table positions.
type CompiledProblem = Readonly<{
  personIds: readonly string[]
  tableIds: readonly string[]
  capacities: Int32Array
  lockedTable: Int32Array // -1 means unlocked
  separatedFrom: readonly (readonly number[])[]
  clausesByAffectedPerson: readonly (readonly number[])[]
  clauses: readonly CompiledClause[]
  positiveBudgetByOwner: readonly number[]
  avoidBudgetByOwner: readonly number[]
}>

export async function solveSeating(input: SearchInput): Promise<SolveResult> {
  throw new Error('not implemented')
}
```

Search internals stay private to solver.ts. No transport schema or mutable search arrays leak into callers. One authoritative objective comparator shared by full evaluation and search ensures Balanced means the same thing in results and optimization; tests independently enumerate tiny problems to catch scoring or pruning bugs.

## Algorithm and invariants

Compile once into dense indices, per-person constraint adjacency, and per-clause affected-person indexes. This gives direct capacity/separation checks and targeted score updates without scanning every clause on every move. Lock assignments initialize the search and reduce domains. Static capacity shortfall, locked overcapacity and locked separation conflicts can prove infeasibility immediately.

Construct a valid seed using constrained-person-first depth-first placement with deterministic table ordering. Its search is complete but deadline bounded. A failed greedy attempt never proves infeasibility. Keep residual capacities and each person's remaining allowed tables; prune only verified impossibility (empty domain or insufficient residual capacity). Once a seed exists, retain it permanently as the incumbent.

Use a bounded deterministic improvement phase (legal single-person moves and pair swaps) for practical large-event quality. All moves satisfy hard constraints before accepting them. Greedy restart variation uses a seeded PRNG, so fixture runs can reproduce a chosen search path. This phase claims only feasible solutions.

Spend the remaining budget on exact depth-first branch and bound, preferring incumbent table choices first. The basic admissible objective bound treats each undecided positive clause as satisfiable and each undecided avoidance as avoidable. Coverage bounds count a person as potentially covered if they have any unresolved achievable positive clause. The bound may be loose; it must never underestimate possible improvement. For fairness, each attendee's upper satisfaction assumes all their undecided clauses can succeed. Do not invent tighter bounds during implementation without exhaustive small-instance verification.

Only remove symmetry between tables that are truly interchangeable: same capacity and no lock or other rule identifies either table. Simplest first implementation skips symmetry reduction; correctness exceeds speculative speed. Exact search can prove optimality by exhausting all feasible assignments or reaching a certified global objective ceiling. It proves infeasibility only after exhaustive search without an incumbent. On a deadline: return feasible incumbent if one exists; otherwise return timeout. Never label a heuristic result optimal.

Search checks performance.now() frequently, including seed construction, clause evaluation, swaps and recursion. Yield with a macrotask after a small node/time quota to avoid freezing Node's event loop; no added worker bundling is required initially. The one solve call owns all mutable arrays, so concurrent requests share no search state. For larger deployment, the same pure solver can move into a Node worker without changing domain semantics.

## Objective and interpretation policy

Keep directed preferences: a clause rewards its owner, even though table sharing is symmetric. Each resolved clause has ANY semantics and earns once regardless of target count. Group expansion uses roster data; duplicate clauses are deduplicated by owner/kind/target set before budgets are computed. No LLM chooses attendee IDs. Unresolved clauses must be resolved or explicitly ignored before solving. AI remains an optional configured HTTP extractor and the credential-free list parser remains labeled honestly.

Balanced lexicographically minimizes per-owner normalized unmet avoidance, then maximizes positive-request attendee coverage, then maximizes normalized positive satisfaction. Use rational comparisons via integer cross products or precompiled fixed-point normalization with a documented scale, not floating tolerances. Fairness minimizes avoidance then maximizes minimum positive satisfaction among attendees with positive requests, with normalized sum as tie break; impossible preferences may make its minimum zero and this is documented. Maximum preferences intentionally maximizes raw weights because the current UI explicitly advertises that behavior. No automatic policy change is hidden in the runtime replacement.

## Rationale and interface depth

This replaces one deep capability at one seam and keeps roster, interpretation, storage and UI intact. The organizer still asks only for a seating plan; compilation, deadlines, feasibility, search phases, proof status and verification stay behind solveSeating. The only installation requirement remains the project's JavaScript toolchain.

We accept weaker practical search quality at 100–300 attendees in exchange for zero native binaries, WASM assets, external processes or second language. Exact proofs will generally be limited to small/easy instances; large instances promise a best-found feasible arrangement within the budget. An event with difficult separation constraints may time out before finding a feasible plan. These are real limitations, not errors to disguise.

## Alternatives considered

Server HiGHS WASM hides mature mixed-integer optimization behind a small facade and offers stronger bounds, but adds model linearization, binary asset loading, solver startup and package lifecycle constraints. Prefer it when proving optimality at event scale matters more than an entirely native TypeScript engine. Browser worker + IndexedDB removes the solve server but changes the existing architecture and leaves AI interpretation on the server; it is unnecessary for the current hard constraint.

## Red flags screened

No duplicated state owner: workspace owns event persistence and each solver invocation owns private arrays. No stage-shaped public APIs. No parallel legacy solver path. No independent browser implementation of objective semantics. No false optimal/infeasible classification. The implementation must remove all abandoned runtime files and instructions in the same change.

## Next implementation step

Add solver.ts against existing event/result schemas, prove its results against brute-force enumeration of tiny tables and timeout fixtures, then replace engine.server.ts solve and delete the abandoned runtime and setup instructions.
