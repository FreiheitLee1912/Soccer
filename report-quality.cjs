const countFields=['goals','assists','own_goals','yellow_cards','red_cards'];
function validateRecords(records){
  const errors=[],seen=new Set(),matches=new Map();
  for(const r of records){
    const key=r.match_id+':'+r.player_id,fail=reason=>errors.push({match_id:r.match_id,player_id:r.player_id,reason});
    if(seen.has(key))fail('Duplicate match/player');seen.add(key);
    if(!/^https:\/\//.test(r.source_url||''))fail('Missing source URL');
    if(!Number.isFinite(Date.parse(r.kickoff_local)))fail('Invalid local match date');
    for(const k of countFields)if(r[k]!=null&&(!Number.isInteger(r[k])||r[k]<0))fail('Invalid '+k);
    for(const k of ['home_goals','away_goals'])if(!Number.isInteger(r[k])||r[k]<0)fail('Invalid final '+k);
    if(r.minutes!=null&&(!Number.isFinite(r.minutes)||r.minutes<0||r.minutes>150))fail('Invalid minutes');
    if(r.rating!=null&&(!Number.isFinite(r.rating)||r.rating<0||r.rating>10))fail('Invalid rating');
    if(![r.home_id,r.away_id].some(id=>String(id)===String(r.club_id)))fail('Player club is not a match team');
    const own=String(r.club_id)===String(r.home_id)?r.home_goals:r.away_goals;
    if(r.goals!=null&&r.goals>own)fail('Player goals exceed team score');
    if(r.assists!=null&&r.assists>own)fail('Player assists exceed team score');
    if(/unconfirmed/i.test(r.status||''))for(const k of [...countFields,'minutes','rating'])if(r[k]!=null)fail('Unconfirmed selection has '+k);
    for(const issue of r.quality_issues||[])if(r[issue.field]!=null)fail('Unresolved conflict has a published value: '+issue.field);
    for(const [field,evidence] of Object.entries(r.event_evidence||{})){
      const events=evidence.events||[];
      if(!/^https:\/\//.test(evidence.source_url||'')||!events.length||events.some(e=>!e.event_id)||new Set(events.map(e=>e.event_id)).size!==events.length)fail('Invalid event evidence: '+field);
      if(r[field]!=null&&r[field]!==events.length)fail('Statistic differs from positive event evidence: '+field);
    }
    const score=[r.home_goals,r.away_goals,r.home_id,r.away_id].join(':');
    if(matches.has(r.match_id)&&matches.get(r.match_id)!==score)fail('Conflicting final score/team identities');matches.set(r.match_id,score);
  }
  for(const mid of new Set(records.map(r=>r.match_id))){
    const rows=records.filter(r=>r.match_id===mid),first=rows[0];
    for(const [id,score] of [[first.home_id,first.home_goals],[first.away_id,first.away_goals]]){
      const side=rows.filter(r=>String(r.club_id)===String(id));
      const opposing=rows.filter(r=>String(r.club_id)!==String(id));
      const goals=side.reduce((n,r)=>n+(r.goals||0),0)+opposing.reduce((n,r)=>n+(r.own_goals||0),0);
      if(goals>score||side.reduce((n,r)=>n+(r.assists||0),0)>score)errors.push({match_id:mid,reason:'Tracked player contributions exceed team score'});
    }
  }
  return errors;
}
function assertValidRecords(records){const errors=validateRecords(records);if(errors.length)throw Error('Match data failed validation: '+JSON.stringify(errors.slice(0,8)))}
module.exports={validateRecords,assertValidRecords};
