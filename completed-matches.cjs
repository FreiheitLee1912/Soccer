const {normalize}=require('./sofascore-season.cjs');
const {competitionInfo,applicableAffiliation}=require('./competition-info.cjs');
const affiliations=p=>typeof p.affiliations==='string'?JSON.parse(p.affiliations):p.affiliations||[p];
function localTime(utc,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(utc)).map(x=>[x.type,x.value]));return`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`}
function weekOf(local){const d=new Date(local.slice(0,10)+'T00:00:00Z'),day=d.getUTCDay();d.setUTCDate(d.getUTCDate()+(day===1?-1:day===0?0:7-day));const th=new Date(d);th.setUTCDate(d.getUTCDate()-3);const y=th.getUTCFullYear(),j=new Date(Date.UTC(y,0,4));j.setUTCDate(j.getUTCDate()-((j.getUTCDay()+6)%7));return y+'-W'+String(Math.floor((d-j)/604800000)+1).padStart(2,'0')}
function parseCompletedMatch(d,seed,zone,url,checked){
 if(!d.general?.finished||!d.header?.status?.finished||d.header.status.cancelled||d.header.status.awarded)return[];
 const teams=d.header.teams;if(!teams||teams.length!==2||!teams.every(t=>Number.isInteger(t.score)))throw Error('Unverified final score');
 const info=competitionInfo(d.general,seed);if(!info)return[];const european=info.international;
 const lineup=d.content?.lineup;if(info.type==='league'&&(!lineup?.homeTeam||!lineup?.awayTeam))throw Error('Published lineup unavailable');
 const kickoff=d.general.matchTimeUTCDate;if(!Number.isFinite(Date.parse(kickoff)))throw Error('Unknown kickoff');const local=localTime(kickoff,zone),rows=[],seen=new Set();
 const penalties=d.header.status.reason?.penalties;const shootout=Array.isArray(penalties)&&penalties.length===2&&penalties.every(Number.isInteger);
 const resultMethod=shootout?'Penalties':/extra|aet/i.test(d.header.status.reason?.shortKey||'')?'After extra time':'Full time';
 for(const p of seed.players)for(const a of affiliations(p)){
  if(!applicableAffiliation(info,p,a,seed,local.slice(0,10))||seen.has(p.player_id))continue;
  if(!teams.some(t=>String(t.id)===String(a.club_id)))continue;
  const side=[lineup?.homeTeam,lineup?.awayTeam].find(t=>t&&String(t.id)===String(a.club_id))||{id:a.club_id};
  const people=[...(side.starters||[]),...(side.subs||[])],known=seed.season_totals_snapshot?.rows?.find(r=>r.player_id===p.player_id&&String(r.club_id)===String(a.club_id))?.fotmob_player_id;
  const id=/^fm-\d+$/.test(p.player_id)?Number(p.player_id.slice(3)):known;
  const found=people.filter(x=>id?x.id===id:normalize(x.name)===normalize(p.name_en));if(found.length>1)throw Error('Ambiguous player');const person=found[0];
  const complete=side.starters?.length===11&&Array.isArray(side.subs);
  if(!person&&!complete&&info.type==='league')continue;
  const ps=person?d.content.playerStats?.[person.id]:null;const values=Object.fromEntries((ps?.stats||[]).flatMap(g=>Object.values(g.stats||{})).filter(s=>s.key).map(s=>[s.key,s.stat?.value]));
  const val=(...keys)=>{for(const key of keys){const v=values[key];if(typeof v==='number'&&Number.isFinite(v))return v}return null};
  const started=person&&(side.starters||[]).some(x=>x.id===person.id),entered=person?.performance?.substitutionEvents?.some(e=>e.type==='subIn')||val('minutes_played')>0;
  const status=!person?(complete?'Not in match squad':european?'Registered · Matchday selection unconfirmed':'Matchday selection unconfirmed'):started?'Started':entered?'Substitute':'Unused substitute';
  if(typeof person?.performance?.rating==='number')values.rating_title=person.performance.rating;
  seen.add(p.player_id);
  rows.push({week:weekOf(local),day_sheet:weekOf(local)+'-'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(local.slice(0,10)+'T00:00:00Z').getUTCDay()],match_id:String(d.general.matchId),player_id:p.player_id,name_ja:p.name_ja,name_en:p.name_en,league:info.name,competition_id:info.id,competition_type:info.type,round:String(d.general.matchRound||d.general.leagueRoundName||''),result_method:resultMethod,home_penalties:shootout?penalties[0]:null,away_penalties:shootout?penalties[1]:null,...(info.type==='cup'?{domestic_league:a.league}:{}),...(european?{registration_source_url:seed.competition_eligibility.find(r=>r.player_id===p.player_id&&String(r.club_id)===String(a.club_id)&&r.competition===info.name&&r.eligible&&r.valid_from<=local.slice(0,10)&&r.valid_until>=local.slice(0,10))?.source_url}:{}),club:a.club,club_id:a.club_id,home:teams[0].name,home_id:teams[0].id,away:teams[1].name,away_id:teams[1].id,home_goals:teams[0].score,away_goals:teams[1].score,kickoff_local:local,kickoff_jst:localTime(kickoff,'Asia/Tokyo')+'+09:00',status,minutes:val('minutes_played'),goals:val('goals'),assists:val('assists'),own_goals:val('own_goals'),yellow_cards:val('yellow_cards','yellow_card'),red_cards:val('red_cards','red_card'),rating:val('rating_title','rating'),rating_provider:'FotMob',source_url:url,verified_at:checked,verification_status:person||complete?'Verified final match and lineup':european?'Verified final match and UEFA registration':'Verified final match; player selection unconfirmed',notes:'Automatically refreshed from the final FotMob match record; missing provider statistics remain unknown.'});
 }
 return rows;
}
module.exports={parseCompletedMatch,localTime,weekOf,affiliations};
