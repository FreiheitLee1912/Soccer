# Season ratings and fixture venues

User requested a Sofascore season rating in Player Summary and replacing displayed IANA timezone names with city/stadium names. Preserve weekly FotMob ratings and weekly statistics. Show a separate Sofascore season column containing the source's domestic-league season average, rated-match count, season, source link and check date. Current European season is 26/27; calendar leagues use 2026. Multiple affiliations remain separate. Sorting uses the highest available displayed affiliation rating. Missing data stays blank; previous seasons, cup averages and other providers are never substituted.

Resolve Japanese player identities from Sofascore searches using football, normalized names, nationality and current-club corroboration for ambiguous names. Match both competition country and name before selecting an explicitly current season. Reject source error payloads and retain last-good verified data if refreshing fails. Scheduled refresh preserves embedded snapshots for publication fallback.

Show venue-local kickoff followed by the source-confirmed city and match stadium, for example `Burnley / Turf Moor`. Retrieve the stadium from each match's FotMob info box and validate the match ID. Keep timezone data internally for kickoff dates. Missing venue information is `Venue TBC`; do not treat `Europe/London` as evidence that the match is in London.

Validation covers correct person, country, season and rating availability; season ratings without weekly appearances; city/stadium and missing-venue rendering; original report boundaries and Endo's UEFA exclusion; desktop/mobile display; deployed page and Actions result.
