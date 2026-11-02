# Candidate A, revised: TypeScript model compiler with server-side HiGHS WASM

## Ground and reason for scrapping

`model.ts` already owns Zod schemas, deduplicated directed clauses, group ANY scoring, and independent assignment verification. `actions.ts` exposes validated TanStack server functions and dynamically imports `engine.server.ts`. `workspace.tsx` owns the browser-persisted event snapshot and rejects stale solve responses by snapshot identity. `engine.server.ts` currently mixes extraction with process launching; replace its solver implementation, retaining its public `solve(event): Promise<SolveResult>` surface. Remove all external interpreter implementation, dependencies, setup scripts, test scripts, and documentation references. Do not migrate storage or redesign the workspace during this change.

## Usage first

```ts
// Existing UI call remains the whole public surface.
const result = await optimizeSeating({ data: snapshot })
if (result.kind === 'plan') {
  // Existing independent evaluator supplies the report.
  const report = evaluatePlan(snapshot, result.assignments)
  showPlan(result, report)
} else showProblem(result.message)
```

`npm install`, `npm test`, `npm run build`, and the usual web command must suffice. No external interpreter, solver daemon, or post-install compilation.

## Module shape

- `model.ts`: keep event schema, result union, deduplication, and independent evaluator authoritative.
- `engine.server.ts`: retain `interpret`; `solve` checks unresolved references, invokes TypeScript optimizer, independently verifies assignments, and returns existing result type.
- `optimization.server.ts`: one deep private module owns mathematical model generation, objective policy, HiGHS loading, status decoding, worker lifetime, and mapping solver column indices to registered IDs. No LP strings or HiGHS types escape to routes.
- `seating.test.ts`: preserve pure tests; add real solver cases using the same exported `solve` used by the server.
- `vite.config.ts`: explicitly externalize `highs` for SSR if needed after a production smoke check; do not add browser WASM plugins.

```ts
// Reuse schema-derived existing types; introduce only private compiler types.
interface CompiledProblem {
  lp: string
  personColumns: ReadonlyArray<{ personId: string; columnsByTable: readonly string[] }>
  tableIds: readonly string[]
}
async function optimize(event: SeatingEvent): Promise<SolveResult> {
  throw new Error('not implemented')
}
function compile(event: SeatingEvent): CompiledProblem {
  throw new Error('not implemented')
}
```

## Exact binary linear formulation

Use x_it binary: sum_t x_it = 1, sum_i x_it <= capacity_t. Locks set x_it = 1; separation enforces x_at + x_bt <= 1 at every table. Generate all variable names from numeric indices, never attendee text.

For each resolved clause c by author i and table t, add binary w_ct representing whether the author sits at t with ANY clause target. Enforce w_ct <= x_it; w_ct <= sum_(j in targets_c) x_jt; and w_ct >= x_it + x_jt - 1 for each target j. Clause match m_c = sum_t w_ct is automatically binary since the author has exactly one table. Positive met value is m_c; avoidance met value is 1 - m_c. This encodes ANY correctly without awarding a group one reward per member. Coverage variable h_i is the OR of positive m_c values owned by i. Skip all pair variables that no clause needs.

Preserve the selected objective modes and current bounded per-person normalization policy exactly. Translate the existing integer coefficients, including dominance coefficients, into one linear objective; do not invent a new fairness policy while replacing the solver. If coefficients would become numerically large, solve lexicographic stages and fix prior proven objective values instead. Never advance a stage whose optimum was not proven; return its best validated incumbent as feasible. Avoidance soft penalties remain soft, locks and organizer separations remain hard.

Use fixed integer normalization (per-person budget, distribute by clause weight) rather than unconstrained floating-point ratios. Verify same objective rankings with brute-force enumeration on tiny examples. Count model rows/terms before materialization: nominal schema limits permit huge dense group models, so enforce a documented practical model budget rather than risking memory exhaustion.

## Packaging and runtime

Primary package documentation states that initialization is async, solve is synchronous, and recommends a worker to avoid blocking. Current npm metadata reports `highs@1.15.4`, Node >=18, with typed ESM/CommonJS entrypoints and exported WASM subpath `highs/runtime`. These facts were verified rather than inferred from older package layouts. See [package manifest](https://github.com/lovasoa/highs-js/blob/main/package.json) and [typed API](https://github.com/lovasoa/highs-js/blob/main/types.d.ts).

Load exclusively server-side using `createRequire(import.meta.url)`. Resolve the module with `require.resolve('highs')` and WASM using `require.resolve('highs/runtime')`; do not assume `/build/highs.wasm` is importable through package exports or resolve relative to the working directory. Passing `wasmBinary: new Uint8Array(readFileSync(wasmPath))` is safest across Vite SSR layout changes; alternatively `locateFile` returns the absolute resolved WASM path. Package assets stay installed in node_modules, outside Vite's client bundle. Production verification must run an actual optimization against the built server.

To preserve a responsive Node server, launch one Node worker per solve. A tiny trusted runtime bootstrap string in the TypeScript private module can `require(workerData.loaderPath)`, load the supplied `wasmBinary`, call solve with supplied generated LP and fixed options, then post structured results. This avoids fragile `.ts` worker URLs and needing a second build pipeline. The bootstrap contains no seating policy; all typed model generation and output validation remain TypeScript. Worker messages enter as unknown and pass a schema/guard; the main thread never trusts imported solver output blindly. If a generated bootstrap is undesirable, use a build-emitted TypeScript worker entry, but verify both development and built entry resolution before committing to that shape.

Use native `time_limit` plus an outer worker termination deadline. Worker termination can yield timeout but cannot recover an incumbent never posted. A native time limit with a valid incumbent yields feasible; a native proven infeasible result yields infeasible; a limit without a valid incumbent yields timeout. Native Optimal is not enough when using nonzero MIP gap defaults: request zero absolute/relative gap for an exact optimal claim, or expose only feasible when proof tolerance remains. Unexpected statuses/errors reject explicitly; they must never masquerade as infeasible. Validate binary values within tolerance, require exactly one selected x per attendee, and run `evaluatePlan` before returning. Dispose models if using persistent API; the simpler one-shot `solve(lp, options)` destroys each native instance itself per upstream documentation.

## Synthesis decision

This revision replaces the language boundary while preserving the already built domain ownership and UI contract. It uses an exact mixed-integer formulation rather than introducing a parallel heuristic path.

## Tradeoffs and alternatives

We accept an installed WASM package and private Node worker bootstrap in exchange for a single npm-managed application with bounded server blocking. A browser worker would reduce server compute but complicate WASM asset delivery and duplicate solve boundary handling. A custom TypeScript branch-and-bound implementation avoids a package but exposes search quality, proof correctness, and exponential behavior to application code. A native solver executable recreates the external installation problem.

## Red-flag check

One mathematical compiler; one solver path; one independent evaluator; existing domain schemas stay authoritative. No worker domain logic, no duplicated report formulas, no arbitrary attendee strings entering LP syntax, no rewritten state layer. The only transport adapter is private to the optimizer.

## First implementation step

Install the pinned package and prove a tiny integer model loads from both development and production server contexts, then replace the subprocess path and delete every external interpreter artifact before broadening functional tests.
