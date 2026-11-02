# Split editor revision

The UI is a full-window split: a map at the left and a three-column editable attendee table at the right. Mobile stacks the map above the input. No navigation rail, decorative headings, icons, status strips, statistics, or slogans.

The map uses pointer capture for dragging and two-finger pinch, wheel zoom anchored at the cursor, and text-only zoom controls. Long rectangular tables have individual capacities. Table count and the selected table's capacity are directly editable. Selecting a guest links their map seat and input row.

The attendee grid has Name, Preference message, and Names / codes columns. Exact name chips add directed companion requests. Shared code chips define membership and request a companion with the same code. Free text still uses the extraction/resolution boundary. Unknown fragments stay editable in their row rather than taking the user to another screen.

Two map implementations were considered: SVG viewBox and a DOM scene with a translated/scaled coordinate system. The DOM scene is selected because attendee seats remain ordinary keyboard-accessible controls; one camera transform owns pan and zoom. Core layout/camera calculations are pure functions. No diagram framework is needed.

Tokens: paper #ffffff, map #eef0f2, ink #30343b, rule #dce0e5, selection #4766aa, chip #e9edf5. One plain system sans-serif. All content is left aligned. Color distinguishes selection and code membership, not satisfaction.

Revised against the brief: remove the entire earlier visual hierarchy and dashboard state, rather than restyling cards. Table names and form/table labels identify editable data and controls. There are no display headings.
