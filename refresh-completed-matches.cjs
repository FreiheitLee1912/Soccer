const fs=require('node:fs');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const run=promisify(execFile);
const {parseCompletedMatch,affiliations}=require('./completed-matches.cjs');
const {competitionInfo,applicableAffiliation}=require('./competition-info.cjs');
const html=fs.readFileSync('japanese-players.html','utf8'),seed=JSON.parse(html.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
const zones={ENG:'Europe/London',SCO:'Europe/London',WAL:'Europe/London',NIR:'Europe/London',GER:'Europe/Berlin',ESP:'Europe/Madrid',FRA:'Europe/Paris',ITA:'Europe/Rome',BEL:'Europe/Brussels',NED:'Europe/Amsterdam',POR:'Europe/Lisbon',AUT:'Europe/Vienna',SUI:'Europe/Zurich',DEN:'Europe/Copenhagen',SWE:'Europe/Stockholm',NOR:'Europe/Oslo',FIN:'Europe/Helsinki',POL:'Europe/Warsaw',CZE:'Europe/Prague',CRO:'Europe/Zagreb',SRB:'Europe/Belgrade',GRE:'Europe/Athens',TUR:'Europe/Istanbul',UKR:'Europe/Kyiv',ROU:'Europe/Bucharest',HUN:'Europe/Budapest',SVK:'Europe/Bratislava',SVN:'Europe/Ljubljana',BUL:'Europe/Sofia',CYP:'Asia/Nicosia',ISR:'Asia/Jerusalem',IRL:'Europe/Dublin',ISL:'Atlantic/Reykjavik',AZE:'Asia/Baku',GEO:'Asia/Tbilisi',ARM:'Asia/Yerevan',KAZ:'Asia/Almaty'};
zones.LVA='Europe/Riga';zones.LTU='Europe/Vilnius';zones.EST='Europe/Tallinn';zones.LIE='Europe/Vaduz';
async function page(url){const{stdout}=await run('curl',['-f','-L','-s','--max-time','30','--retry','1',url],{maxBuffer:12*1024*1024});const m=stdout.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);if(!m)throw Error('Missing published source data');return JSON.parse(m[1]).props.pageProps}
async function pool(items,fn){let index=0;await Promise.all(Array.from({length:5},async()=>{while(index<items.length)await fn(items[index++])}))}
async function main(){
 const {assertValidRecords}=require('./report-quality.cjs');
 const ids=[...new Set(seed.players.flatMap(p=>affiliations(p).map(a=>Number(a.club_id))))],matches=new Map(),errors=[],coverage=new Map(),clubs=[];
 const now=new Date(),from=new Date(now);from.setUTCDate(from.getUTCDate()-8);
 await pool(ids,async id=>{try{
  const t=(await page(`https://www.fotmob.com/teams/${id}/fixtures/team`)).fallback[`team-${id}`],zone=zones[t.details.country];
  if(!zone)throw Error('Unknown local timezone');if(!Array.isArray(t.fixtures?.allFixtures?.fixtures))throw Error('Missing fixture list');
  clubs.push({club_id:id,status:'checked'});
  for(const f of t.fixtures.allFixtures.fixtures){
   const date=new Date(f.status.utcTime);if(!f.status.finished||f.status.cancelled||date<from||date>now)continue;
   const mid=String(f.id),url='https://www.fotmob.com'+f.pageUrl,info=competitionInfo(f.tournament,seed);
   if(!info){
    if(!/friendl|test match/i.test(f.tournament.name||'')){coverage.set(mid,{match_id:mid,date:f.status.utcTime,source_url:url,status:'unrecognized_competition',competition:f.tournament.name});errors.push({match_id:mid,source_url:url,error:'Unrecognized competition: '+f.tournament.name})}
    continue;
   }
   const applicable=seed.players.some(p=>affiliations(p).some(a=>Number(a.club_id)===id&&(info.international||applicableAffiliation(info,p,a,seed,f.status.utcTime.slice(0,10)))));
   if(!applicable)continue;
   coverage.set(mid,{match_id:mid,date:f.status.utcTime,source_url:url,status:'pending'});
   matches.set(mid,{id:mid,url,european:info.international,home_id:f.home.id,zone:/Las Palmas|Tenerife/i.test(f.home.name)?'Atlantic/Canary':zone});
  }
 }catch(e){clubs.push({club_id:id,status:'source_unavailable'});errors.push({club_id:id,error:e.message})}});
 const previousSnapshot=fs.existsSync('weekly-records.json')?JSON.parse(fs.readFileSync('weekly-records.json','utf8')):null,previous=previousSnapshot?.records||[];
 const records=new Map(previous.map(r=>[r.match_id+':'+r.player_id,r]));let checked=0;
 await pool([...matches.values()],async m=>{try{
  const d=await page(m.url);if(String(d.general?.matchId)!==m.id)throw Error('Match identity mismatch');
  if(!d.general?.finished||!d.header?.status?.finished)throw Error('Source final-status mismatch');
  let zone=m.zone;if(m.european){const host=(await page(`https://www.fotmob.com/teams/${m.home_id}/overview/team`)).fallback[`team-${m.home_id}`];zone=/Las Palmas|Tenerife/i.test(host.details.name)?'Atlantic/Canary':zones[host.details.country];if(!zone)throw Error('Unknown UEFA venue timezone')}
  const rows=parseCompletedMatch(d,seed,zone,m.url,now.toISOString());assertValidRecords(rows);
  if(!rows.length){
   const teams=[d.content?.lineup?.homeTeam,d.content?.lineup?.awayTeam];
   if(!teams.every(t=>t?.starters?.length===11&&Array.isArray(t.subs)))throw Error('Empty player result without complete squad evidence');
  }
  for(const r of rows){
   const key=r.match_id+':'+r.player_id,prior=records.get(key);
   for(const [metric,field] of [['goals','goal_confirmation_source_url'],['assists','assist_confirmation_source_url'],['own_goals','own_goal_confirmation_source_url']])if(prior?.[field]&&prior[metric]===r[metric])r[field]=prior[field];
   records.set(key,r);
  }
  coverage.set(m.id,{...coverage.get(m.id),status:rows.length?'recorded':'no_watched_player_in_squad',player_records:rows.length,unconfirmed_records:rows.filter(r=>/unconfirmed/i.test(r.status)).length});checked++;
  console.log('Completed '+m.id+' · '+rows.length+' players');
 }catch(e){coverage.set(m.id,{...coverage.get(m.id),status:'source_unavailable'});errors.push({match_id:m.id,source_url:m.url,error:e.message})}});
 if(!checked&&!previousSnapshot?.updated_at)throw Error('No verified snapshot or completed sources available');
 if([...coverage.values()].some(c=>c.status==='pending'))throw Error('Unaccounted completed fixture; preserving previous snapshot');
 const values=[...records.values()].sort((a,b)=>a.kickoff_local.localeCompare(b.kickoff_local)||a.player_id.localeCompare(b.player_id));assertValidRecords(values);
 const qualityIssues=values.flatMap(r=>(r.quality_issues||[]).map(issue=>({match_id:r.match_id,player_id:r.player_id,...issue})));
 const snapshot={updated_at:checked?now.toISOString():previousSnapshot.updated_at,last_attempt_at:now.toISOString(),checked_matches:checked,records:values,errors,quality_issues:qualityIssues,coverage:{from:from.toISOString(),to:now.toISOString(),clubs:clubs.sort((a,b)=>a.club_id-b.club_id),matches:[...coverage.values()].sort((a,b)=>a.match_id.localeCompare(b.match_id))}};
 fs.writeFileSync('weekly-records.json',JSON.stringify(snapshot,null,2)+'\n');
 const file='japanese-players.html',current=fs.readFileSync(file,'utf8'),currentSeed=JSON.parse(current.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);currentSeed.weekly_snapshot=snapshot;
 fs.writeFileSync(file,current.replace(/(<script[^>]*id="seed"[^>]*>)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(currentSeed).replace(/</g,'\\u003c')+b));
 for(const e of errors)console.warn('::warning::Match coverage: '+JSON.stringify(e));
 for(const issue of qualityIssues)console.warn('::warning::Match statistic awaiting verification: '+JSON.stringify(issue));
 console.log('Saved '+snapshot.records.length+' player match records; '+errors.length+' source gaps; '+qualityIssues.length+' unresolved statistics');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
