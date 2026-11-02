# Mutual preference groups

`findPreferenceCliques(event)` returns `{cliques: string[][], truncated: boolean}`. It uses resolved positive single-target named requests, deduplicates edges, and retains an undirected edge only when both people named each other. Unused messages, shared tags, avoidance and ANY alternatives do not create edges.

A clique contains at least three people, all mutually connected. Find maximal cliques so a complete four-person group is recorded once instead of as four triangles. Keep overlapping maximal groups separate; merging them would invent missing relationships. Bron–Kerbosch search with pivoting uses stable attendee ordering and stops after 20,000 recursive visits or 256 groups. Returned groups are always real maximal cliques; `truncated` means others may be missing.

The table model adds an exact AND witness for all members sharing each table that can fit the group. Its reward is the group size. Preserve packing, hard rules, avoidance priorities, companion coverage, fairness-mode minimum satisfaction, and named-request scoring first; then maximize intact-group rewards before tag-score improvements. Keeping a clique intact must not deprive more attendees of all their wishes. In weighted mode the group objective follows weighted-request scoring. This distinguishes a whole social group from scattered pairings when individual request scores tie. Oversized groups receive no intact-table reward, while their original individual preferences continue to influence placement. Groups are soft and may split when higher priorities require it.

Existing pair preferences and the popular-companion center tie-breaker refine chairs after tables are assigned. No extra inferred chips or persistent attendee metadata are created.

Debug rules expose the same detected groups as member hubs with together/split resolution. The solver trace records the actual group-preservation objective and its exact detection input, including whether the search was truncated. Changing this policy increments the solver version so an earlier trace is not reused as current evidence.
