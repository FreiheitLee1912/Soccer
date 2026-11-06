const fs=require('node:fs');
const {assertValidRecords}=require('./report-quality.cjs');
function verifySnapshot(snapshot,seed){
  if(!Array.isArray(snapshot?.records))throw Error('Missing records');
  assertValidRecords(snapshot.records);
  if(seed&&JSON.stringify(seed.weekly_snapshot)!==JSON.stringify(snapshot))throw Error('HTML and match snapshot differ');
  if(snapshot.coverage){
    const matches=snapshot.coverage.matches,clubs=snapshot.coverage.clubs;
    if(!Array.isArray(matches)||!Array.isArray(clubs))throw Error('Missing coverage audit');
    if(new Set(matches.map(c=>c.match_id)).size!==matches.length)throw Error('Duplicate coverage match');
    const statuses=new Set(['recorded','no_watched_player_in_squad','source_unavailable','unrecognized_competition']);
    if(matches.some(c=>!statuses.has(c.status)||!c.source_url))throw Error('Unaccounted completed fixture');
    if(matches.filter(c=>['recorded','no_watched_player_in_squad'].includes(c.status)).length!==snapshot.checked_matches)throw Error('Checked-match count disagrees with coverage');
    for(const c of matches.filter(c=>c.status==='recorded')){
      const rows=snapshot.records.filter(r=>r.match_id===c.match_id);
      if(!rows.length||rows.length!==c.player_records)throw Error('Coverage record count mismatch: '+c.match_id);
    }
    if(seed){
      const ids=new Set(seed.players.flatMap(p=>(typeof p.affiliations==='string'?JSON.parse(p.affiliations):p.affiliations||[p]).map(a=>String(a.club_id))));
      if(clubs.length!==ids.size||new Set(clubs.map(c=>String(c.club_id))).size!==ids.size||clubs.some(c=>!ids.has(String(c.club_id))))throw Error('Club coverage incomplete');
    }
  }
  return true;
}
if(require.main===module){
  const snapshot=JSON.parse(fs.readFileSync('weekly-records.json','utf8'));
  const html=fs.readFileSync('japanese-players.html','utf8'),seed=JSON.parse(html.match(/id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
  verifySnapshot(snapshot,seed);
  console.log('Match publication gate passed: '+snapshot.records.length+' source-linked player records.');
  for(const issue of snapshot.quality_issues||[])console.warn('::warning::Statistic withheld pending verification: '+JSON.stringify(issue));
  for(const gap of snapshot.errors||[])console.warn('::warning::Match source gap: '+JSON.stringify(gap));
}
module.exports={verifySnapshot};
