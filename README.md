# Plassitin

A split seating editor for sitsit. Long tables are on the left and an editable attendee grid is on the right. On mobile, the map sits above the grid.

## Run

Use Node.js 24.

```sh
npm install
npm run dev
```

Open http://localhost:3000. The app stores the complete workspace in the URL and keeps a browser-local fallback. Use **Options → Copy link** to save or share it. Opening a seating link restores that snapshot, taking precedence over browser storage.

## Edit the room

Set the number of tables with the floating Tables input on the map. Click a table to open its popup. Change its seat count or choose **Rotate 90°** to toggle between vertical and horizontal. Names stay upright, and consecutive horizontal tables form parallel rows. Each table has its own capacity. An alert appears immediately if total seats are fewer than attendees, and Arrange remains disabled until there are enough seats.

Drag to pan, scroll or pinch to zoom, or use **Zoom in**, **Zoom out**, and **Fit**. With the map focused, arrow keys pan and the plus, minus, and zero keys zoom or fit. Click a guest to select their input row. Double-click their map seat to lock or unlock their table placement. **Options** can release all locks.

Drag a guest onto a seat square to snap them into place. An occupied seat swaps the two guests; an empty seat moves the guest. Moves between tables respect locks, capacities, and mandatory separations. Manual seat positions survive refreshes and saved seating links. Alt + arrow keys move a focused guest in the screen direction within their table, including rotated tables. Table orientations and seat positions persist in saved seating links.

Arrange now assigns exact chairs as well as tables, filling a continuous block from the start of each table and leaving unused chairs at the end. Preferred companions score highest opposite each other, then adjacent on the same side, then diagonally. Named chips have a fivefold base weight over tags; that budget is split into descending shares in name-chip order, so the first name matters most and narrower lists still carry more influence per match. Tag influence is also shared across that attendee’s matching tag companions, so large groups do not gain unlimited weight. Duplicate names do not add weight. When several people request the same companion, equally good proximity plans favor placing that person centrally among their requesters. Mutually named groups of three or more get an additional preference to stay at the same table when individual request scores tie. Overlapping groups remain separate; capacity limits and mandatory separations still apply. Manual moves can still adjust the result.

## Enter attendees

Edit names and preference messages directly in the grid. Enter a name in **Names / codes** and select the person, or press Enter on an exact name. A name chip creates a directed companion request. Enter a tag such as `#fuksit` on multiple rows to seat those attendees together when possible. Tags create preferences toward every other member with the same tag. Group suggestions are available while typing. Use Up/Down to highlight a result, Enter to select it, and Escape to close the search. Click a name or code chip to remove it; older reference chips can be mapped to a person or removed. Reference edits and manual tags survive reruns and saved seating links.

Importing, editing a message, and **Arrange** never turn message text into chips or constraints. **Infer names** is the explicit action that scans all preference messages against the names column. It matches full names and whole first or last names without case sensitivity. Full names take precedence over shorter matches. Clear matches become name chips in message order, after existing manual chips. Ambiguous names appear as outlined chips marked **ambiguous**. Select a chip to choose among the matching attendees or remove the reference. Repeating inference preserves existing chips and decisions without adding duplicates. Tags and unknown prose remain untouched. Only chips explicitly entered, inferred, or mapped in **Names / codes** affect the arrangement. An empty chip field means no preference constraints for that attendee; unused message text remains unchanged. Resolve or remove any outlined chips you explicitly added before arranging. Changes during a solve prevent its stale result from replacing the edited workspace.

**Options → Clear all** opens a confirmation dialog. Confirming removes attendees, messages, chips, placements, locks, mapping decisions, legacy saved data, and the cached solver trace. It resets to three tables with sixteen seats each and Balanced optimization. The empty workspace replaces the current URL and browser save, so it stays empty after refresh. Cancel or Escape preserves the current workspace.

**Import** opens a modal for pasting two-column CSV: name, then preference message. The header row is optional (`name,preferences`). Quote messages containing commas or line breaks. Choose **Preview** to review every row, then **Import attendees** to replace the current roster, preferences, and placements. Import keeps the preference messages as text and leaves chip fields empty. **Back** returns to the pasted text; **Cancel** leaves the workspace unchanged. Retired “anyone from” chips in older links are converted into shared tags.

```csv
name,preferences
Anna,"Mike, Sarah or anyone from Helsinki"
Mike,Anna
```

## Optimize and share

The solver first minimizes the number of occupied tables, then maximizes the number of completely full tables. Among equally packed arrangements, Balanced prioritizes avoidance, giving as many guests as possible at least one preferred tablemate, then named companions, mutual groups, and normalized positive satisfaction. Initial placement fills tables in order, and manual placements remain intact until you arrange again. **Options** also offers raw weighted preferences and minimum individual satisfaction. Matching tags reward seating group members together; capacities and hard rules may split a group. Capacities, locks, and any imported mandatory separations remain hard constraints.

Table optimization uses the npm-managed HiGHS WebAssembly solver inside a bounded Node worker. A separate chair pass keeps those tables fixed. Balanced and Fairness first maximize guests with at least one preferred companion in an opposite, side-adjacent, or diagonal seat, then prefer compact blocks across both sides of the table before optimizing weighted proximity and group distance. Merely sharing a long table does not count as a nearby match. Raw weighted mode keeps its weighted table objective and also prefers blocks when arranging chairs. Tables with at most eight attendees use exhaustive placement (or a proven score bound); longer tables use deterministic, bounded local improvement. Exact table optimality does not prove a globally optimal chair arrangement. The solver keeps the best valid arrangement if it reaches its time limit. Independent validation checks every returned assignment.

**Copy link** replaces file exports. The address updates after edits; the button always encodes the latest state. The URL fragment uses compact JSON, maximum-level raw DEFLATE and unpadded base64url. Names, messages, original interpretations, chips, mapping decisions, tables, rules, assignments and exact seats are preserved. Encoding is not encryption: anyone holding the link can read the complete workspace, including avoidance preferences. The fragment stays out of HTTP requests. Save these links privately.

Self-contained link length grows with the data. The app rejects fragments over 128 KiB and decoded documents over 8 MiB rather than truncating state. Browser storage still saves independently if a link cannot be created. If clipboard access is unavailable, copy the full address bar. An invalid link leaves the current or browser-saved workspace intact and is retained until an edit or explicit Copy link. Remote attendee collection, shared event storage, authentication are outside this local release.

## Inspect the solver

Open **Options → Solver debug** or visit **/debug**. The page uses the seating state in its URL, otherwise the browser's saved workspace. Pan and zoom the constraint network, select guests or tag hubs, and inspect the matching rule rows. Filter by rule type or unmet constraints, or search a name/tag. Shared tags use hubs rather than a web of pairwise lines.

**Run solver** records actual optimization stages without changing the editor's seating. Use **Show** or the **Solver steps** table to replay each stage's assignments. The final **Place nearby companions** stage includes actual chair positions; named-companion rows describe opposite, side, diagonal, or distant seating. Inspect objective includes the actual count of guests with a nearby requested companion. The table records solver outcomes and which proven objective values were fixed before continuing. Objective values are available under **Inspect objective**. If the last accepted Arrange run matches this snapshot, its trace is reused in the same browser tab. Detected mutual groups appear as selectable hubs; the group-preservation stage records which groups were considered and whether detection reached its bound. Capacity shortages, infeasibility and time limits remain visible; no assignment is invented for a stage without an incumbent. This exposes stage outcomes, not the solver's internal branch-and-bound decisions or counterfactual reasons for individual placements.

## Verify and build

```sh
npm test
npm run typecheck
npm run build
npm run preview
```

## Deploy on Vercel

Import this repository into Vercel and use the **TanStack Start** framework preset. Keep the default build command (`npm run build`) and output directory. No environment variables or database are required. The Nitro adapter generates the Vercel function and static assets; the function includes the solver worker and HiGHS WebAssembly runtime, with a 60-second execution limit.

To deploy from this directory instead:

```sh
npx vercel login
npx vercel
```

Choose the Vercel account/team and link or create the project when prompted. This creates a preview deployment. Use `npx vercel --prod` to publish to the project's production domain.

Run `npm run verify:vercel` to build the Vercel output and check both `/` and `/debug`, plus a real solver run, in a temporary directory without access to the source tree or its dependencies.

Vercel Web Analytics is installed in the shared page shell. Enable Web Analytics in the Vercel project's Analytics settings, then redeploy to start collecting page views. Analytics URLs exclude query strings and the seating state in the URL fragment.

Tests run the real optimizer against exhaustive small seating examples and cover mapping, codes, table resizing, import, camera geometry, URL roundtrips, and malformed/oversized link handling. Run the production server from the repository root and include `dist`, `workers`, package files, and installed dependencies.

See [the split editor rationale](docs/architecture/split-editor.md) and [the optimization design](docs/architecture/design.md).
