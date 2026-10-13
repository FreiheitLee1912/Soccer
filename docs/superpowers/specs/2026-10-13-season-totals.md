# Player Summary league season totals

User approved replacing Apps, Min, Goals and Assists with season cumulative league statistics. The columns, filters and related sorting must state that they use season data. Weekly FotMob ratings, completed-match cards and the report's top weekly statistics retain their original week scope.

Read current-season FotMob team squad goals/assists and the explicit MatchesPlayed/MinutesPlayed fields in the linked season minutes table, matching both player and team IDs. Verify the team's season and primary league before using its numbers. Use a verified Sofascore current-season statistics endpoint as a fallback for a complete tuple. Keep each tuple's provider/source/check date, and do not infer an appearance count from the rated-match count. Missing fields remain null, not assumed zero. Do not mix a tuple's fields from different providers. Keep last-good data when refreshing fails.

Multiple first/reserve affiliations are displayed separately. Source column links season stats and weekly/roster evidence separately. Switching report weeks does not change current-season cumulative statistics. Data files and embedded snapshots are refreshed by the existing scheduled Pages workflow.

Verify published zeroes, missing values, season/competition identity, counts independent of rated matches, week switching, season sorting/filtering, responsive table layout, source provenance, and successful deployment.
