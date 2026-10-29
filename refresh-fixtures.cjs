// Refresh source-linked club fixtures for the Japanese player watchlist.
const fs=require('node:fs');
const {competitionInfo}=require('./competition-info.cjs');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const html=fs.readFileSync('japanese-players.html','utf8');
const seed=JSON.parse(html.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
const zones={ENG:'Europe/London',SCO:'Europe/London',WAL:'Europe/London',NIR:'Europe/London',GER:'Europe/Berlin',ESP:'Europe/Madrid',FRA:'Europe/Paris',ITA:'Europe/Rome',BEL:'Europe/Brussels',NED:'Europe/Amsterdam',POR:'Europe/Lisbon',AUT:'Europe/Vienna',SUI:'Europe/Zurich',DEN:'Europe/Copenhagen',SWE:'Europe/Stockholm',NOR:'Europe/Oslo',FIN:'Europe/Helsinki',POL:'Europe/Warsaw',CZE:'Europe/Prague',CRO:'Europe/Zagreb',SRB:'Europe/Belgrade',GRE:'Europe/Athens',TUR:'Europe/Istanbul',UKR:'Europe/Kyiv',ROU:'Europe/Bucharest',HUN:'Europe/Budapest',SVK:'Europe/Bratislava',SVN:'Europe/Ljubljana',BUL:'Europe/Sofia',CYP:'Asia/Nicosia',ISR:'Asia/Jerusalem',IRL:'Europe/Dublin',ISL:'Atlantic/Reykjavik',AZE:'Asia/Baku',GEO:'Asia/Tbilisi',ARM:'Asia/Yerevan',KAZ:'Asia/Almaty'};
const cache=new Map();
zones.LVA='Europe/Riga';zones.LTU='Europe/Vilnius';zones.EST='Europe/Tallinn';zones.LIE='Europe/Vaduz';
function venueZone(host){return /Las Palmas|Tenerife/i.test(host.details.name)?'Atlantic/Canary':zones[host.details.country]}
async function team(id){
  if(!cache.has(id))cache.set(id,(async()=>{
    const url=`https://www.fotmob.com/teams/${id}/fixtures/team`;
    const {stdout}=await run('curl',['-f','-L','-s','--max-time','30','--retry','1',url],{maxBuffer:12*1024*1024});
    const data=stdout.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if(!data)throw Error(`No fixture data for ${id}`);
    const t=JSON.parse(data[1]).props.pageProps.fallback[`team-${id}`];
    if(!t?.details?.country||!Array.isArray(t.fixtures?.allFixtures?.fixtures))throw Error(`Invalid fixture data for ${id}`);
    return t;
  })());
  return cache.get(id);
}
function localTime(utc,zone){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(utc)).map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
async function main(){
  const ids=[...new Set(seed.players.flatMap(p=>(typeof p.affiliations==='string'?JSON.parse(p.affiliations):p.affiliations||[p]).map(a=>Number(a.club_id))))];
  const fixtures=[],errors=[],done=new Set();
  const now=new Date(),from=new Date(now);from.setUTCDate(from.getUTCDate()-8);const to=new Date(now);to.setUTCDate(to.getUTCDate()+28);
  let index=0;
  async function worker(){while(index<ids.length){const id=ids[index++];try{
    const t=await team(id);
    for(const f of t.fixtures.allFixtures.fixtures){
      const date=new Date(f.status.utcTime);
      if(!Number.isFinite(date.getTime())||date<from||date>to||f.status.finished||f.status.cancelled)continue;
      const info=competitionInfo(f.tournament,seed);if(!info)continue;
      const international=info.international;
      const host=Number(f.home.id)===id?t:international?await team(Number(f.home.id)):{details:{country:t.details.country,name:f.home.name}};
      const zone=venueZone(host);
      if(!zone)throw Error(`Unknown venue country ${host.details.country} for match ${f.id}`);
      const key=`${id}:${f.id}`;if(done.has(key))continue;done.add(key);
      fixtures.push({match_id:String(f.id),club_id:id,home:f.home.name,home_id:f.home.id,away:f.away.name,away_id:f.away.id,competition:info.name,competition_id:info.id,competition_type:info.type,round:String(f.tournament.stage||''),kickoff_utc:f.status.utcTime,kickoff_local:localTime(f.status.utcTime,zone),venue_timezone:zone,timezone_basis:international?'Home club country':'Domestic competition country',status:f.status.started?'In progress':'Scheduled',source_url:'https://www.fotmob.com'+f.pageUrl,team_source_url:`https://www.fotmob.com/teams/${id}/fixtures/team`});
    }
    console.log(`Checked ${id} ${t.details.name}`);
  }catch(e){errors.push({club_id:id,error:e.message});console.error(`Failed ${id}: ${e.message}`)}}}
  await Promise.all(Array.from({length:6},worker));
  if(errors.length)throw Error(`${errors.length} club checks failed; preserving previous fixtures.json`);
  fixtures.sort((a,b)=>Date.parse(a.kickoff_utc)-Date.parse(b.kickoff_utc)||a.club_id-b.club_id);
  if(!fixtures.length)throw Error('Empty fixture result; preserving previous fixtures.json');
  const snapshot={updated_at:now.toISOString(),coverage_from:from.toISOString(),coverage_to:to.toISOString(),checked_club_ids:ids,fixtures};
  fs.writeFileSync('fixtures.json',JSON.stringify(snapshot,null,2)+'\n');
  seed.fixture_snapshot=snapshot;
  fs.writeFileSync('japanese-players.html',html.replace(/(<script[^>]*id="seed"[^>]*>)[\s\S]*?(<\/script>)/,(_,open,close)=>open+JSON.stringify(seed).replace(/</g,'\\u003c')+close));
  console.log(`Saved ${fixtures.length} club fixtures for ${ids.length} clubs`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
