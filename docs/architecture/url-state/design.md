# Problem

Replace downloadable exports with a self-contained URL carrying every EditorDocument field. Favor short output without changing saved preference interpretations or seat positions. Workspace remains the sole owner; localStorage remains fallback.

# Usage (caller first)

```ts
const linked = decodeDocumentFragment(location.hash)
if (linked) change(linked) // otherwise existing browser/legacy fallback
const fragment = encodeDocumentFragment(current.current)
history.replaceState(history.state, '', location.pathname + location.search + fragment)
await navigator.clipboard.writeText(location.href)
```

# Shape and sketch

One private protocol in url-state.ts, two synchronous domain-level operations:

```ts
export function encodeDocumentFragment(document: EditorDocument): string {
  throw new Error('not implemented')
  // editorSchema -> compact JSON -> UTF8 -> raw DEFLATE level 9 -> unpadded base64url -> #1.
}
export function decodeDocumentFragment(fragment: string): EditorDocument | null {
  throw new Error('not implemented')
  // empty -> null; version/alphabet/size -> bounded inflate -> fatal UTF8 -> JSON -> editorSchema
}
```

No public wire types. Preserve all clauses including resolution states and targets, and every future schema field automatically. URL load wins over browser storage. Do not rebuild/repair URL snapshots: validated saved state restores exactly. URL/local writes are independent; no persistence until startup completes. Sync codec eliminates compression races; a short cancelled timer batches typing, and Copy link encodes current state immediately. Preserve history.state for the router and use replaceState, never one history entry per edit. Hash navigation feeds the existing owner. Invalid links retain current/fallback document and original fragment until a real edit or explicit copy. Clipboard errors keep the complete link in the address bar.

# Synthesis decision

Candidate B (complete document) is the base. The judge agreed: A's omission/reconstruction of original clause resolution can change state. Use the shared raw-DEFLATE synchronous revision, A's bounded decompression, navigation and invalid-link preservation. No checkpoint requested; proceed. Candidate A gains potential length savings at the cost of a second field inventory and lossy interpretation; reject that tradeoff. Gzip wrappers, padding, query parameter names and percent escaping are omitted. Raw JSON base64 loses compactness. Server tokens lose self-contained operation.

# Tradeoffs accepted

Accept one small compressor dependency and links that grow with actual data in exchange for exact, offline reconstruction. Accept some extra bytes over lossy semantic packing to preserve complete state and schema evolution. Links contain private names/messages; base64url is not encryption. Payload ceilings are safety/transport bounds, not a promise that every messenger supports long URLs. Keep old JSON restore only as migration input; remove export writer and CSV-export helper/UI/tests.

# Verification

Require exact schema roundtrips with Unicode, multiline preferences, ignored/custom resolved clauses, all decision variants, groups, hard rules and sparse seats. Reject bad versions, base64, truncated streams, invalid UTF8/schema and oversized decompression. Browser-check URL precedence over conflicting localStorage, refresh, edits, copy and invalid-link recovery. Measure final encoded length against uncompressed base64 on the same validated document; verify reconstruction before reporting compactness.

# Next implementation step

Implement the two codec operations, then integrate them with existing Workspace startup/save/copy boundaries.

# Verification results

39 tests pass, including exact Unicode/full-state roundtrips, unsupported/truncated input and bounded decompression. Typecheck and production build pass. Browser verification covers URL precedence over poisoned localStorage, Unicode name edits and refresh, hash navigation, damaged-link preservation, and Copy link targeting the live URL. Clipboard transport was intercepted for the test; normal browser permissions still apply. Original browser workspace restored after checks.

A deterministic 24-attendee createDemo snapshot produced 3,687 fragment characters versus 14,124 characters for uncompressed base64url of exactly the same schema-validated document. Exact decoded equality was checked before comparing lengths. This is a sample payload-size comparison, not a latency benchmark or a guarantee for other data. Size is bounded by information in the complete state, including literal messages and interpretations.
