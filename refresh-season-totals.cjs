const fs=require('node:fs'),zlib=require('node:zlib');const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const {normalize,readSeasonTotals}=require('./sofascore-season.cjs');const run=promisify(execFile);
const html=fs.readFileSync('japanese-players.html','utf8'),seed=JSON.parse(html.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
const now=new Date(),year=now.getUTCFullYear()-(now.getUTCMonth()<6?1:0),season=year+'/'+(year+1);
const seasonFor=l=>['Latvian Virsliga','Kazakhstan Premier League'].includes(l)?String(now.getUTCFullYear()):season;
const cache=new Map();let sofaBlocked=false;
async function get(url){if(!cache.has(url))cache.set(url,(async()=>{const {stdout}=await run('curl',['-f','-L','-s','--max-time','30',url],{encoding:'buffer',maxBuffer:12*1024*1024});const bytes=stdout[0]===31&&stdout[1]===139?zlib.gunzipSync(stdout):stdout;return bytes.toString('utf8')})());return cache.get(url)}
async function team(id){const h=await get(`https://www.fotmob.com/teams/${id}/stats/team`),m=h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);if(!m)throw Error('Missing FotMob team source');const t=JSON.parse(m[1]).props.pageProps.fallback[`team-${id}`];if(!t?.squad?.squad||!t.stats)throw Error('Invalid team source');return t}
const valid=x=>typeof x==='number'&&Number.isInteger(x)&&x>=0;
async function fotmob(p,a){
 const t=await team(a.club_id),league=seed.leagues.find(l=>l[0]===a.league);
 if(t.overview?.season!==seasonFor(a.league)||String(t.stats.primaryLeagueId)!==String(league?.[1]))throw Error('FotMob season/league mismatch');
 const members=t.squad.squad.flatMap(g=>g.members||[]).filter(m=>m.ccode==='JPN');
 const pid=/^fm-\d+$/.test(p.player_id)?Number(p.player_id.slice(3)):null;
 const matches=members.filter(m=>pid?m.id===pid:normalize(m.name)===normalize(p.name_en));if(matches.length!==1)throw Error('FotMob player identity not confirmed');const player=matches[0];
 const minutes=t.stats.players.find(s=>s.name==='mins_played');let apps=null,min=null;
 if(minutes?.fetchAllUrl){try{const d=JSON.parse(await get(minutes.fetchAllUrl));if(!Array.isArray(d.TopLists))throw Error('Invalid minute statistics');const entries=d.TopLists.filter(l=>l.StatName==='mins_played').flatMap(l=>l.StatList||[]).filter(s=>s.ParticiantId===player.id&&String(s.TeamId)===String(a.club_id));if(entries.length===1){apps=valid(entries[0].MatchesPlayed)?entries[0].MatchesPlayed:null;min=valid(entries[0].MinutesPlayed)?entries[0].MinutesPlayed:null}}catch{/* Keep explicitly published squad goals/assists if minutes are unavailable. */}}
 return{apps,minutes:min,goals:valid(player.goals)?player.goals:null,assists:valid(player.assists)?player.assists:null,provider:'FotMob',source_url:`https://www.fotmob.com/teams/${a.club_id}/stats/team`,statistics_url:minutes?.fetchAllUrl||null,fotmob_player_id:player.id,season_id:t.stats.primarySeasonId,scope:'Listed club in the domestic league'};
}
async function sofascore(p,a){
 if(sofaBlocked)throw Error('Sofascore unavailable');const r=seed.sofascore_snapshot?.rows.find(r=>r.player_id===p.player_id&&r.league===a.league&&String(r.club_id)===String(a.club_id));
 if(!r?.statistics_url)throw Error('No verified Sofascore season endpoint');const d=JSON.parse(await get(r.statistics_url));if(d.error){if(d.error.code===403)sofaBlocked=true;throw Error('Sofascore source unavailable')}if(!d.statistics)throw Error('Invalid Sofascore statistics');
 return{...readSeasonTotals(d.statistics),provider:'Sofascore',source_url:r.source_url,statistics_url:r.statistics_url,sofascore_player_id:r.sofascore_player_id,season_id:r.season_id,scope:'Player domestic league season total'};
}
async function main(){
 const pairs=seed.players.flatMap(p=>(typeof p.affiliations==='string'?JSON.parse(p.affiliations):p.affiliations||[p]).map(a=>({p,a}))),rows=[],errors=[];
 const previous=fs.existsSync('season-totals.json')?JSON.parse(fs.readFileSync('season-totals.json','utf8')).rows:[];let index=0;
 async function worker(){while(index<pairs.length){const{p,a}=pairs[index++];let stats=null;try{stats=await fotmob(p,a)}catch(e){errors.push({player_id:p.player_id,league:a.league,provider:'FotMob',error:e.message})}
 if(!stats||['apps','minutes','goals','assists'].some(k=>stats[k]===null)){try{const sofa=await sofascore(p,a);if(['apps','minutes','goals','assists'].every(k=>sofa[k]!==null))stats=sofa;else if(!stats)stats=sofa}catch{/* Do not fill gaps with guesses or a different season. */}}
 const old=previous.find(r=>r.player_id===p.player_id&&r.league===a.league&&String(r.club_id)===String(a.club_id)&&r.season===seasonFor(a.league));
 if(old&&(!stats||(['apps','minutes','goals','assists'].some(k=>stats[k]===null)&&['apps','minutes','goals','assists'].every(k=>old[k]!==null)))){rows.push({...old,status:'Saved verified totals (refresh failed)'});continue}
 rows.push({player_id:p.player_id,club_id:a.club_id,league:a.league,season:seasonFor(a.league),apps:null,minutes:null,goals:null,assists:null,...stats,status:stats?'Verified source totals':'No verified season totals',checked_at:now.toISOString()});
 console.log(p.name_en+' · '+a.league+' · '+(stats?stats.provider+' '+stats.apps+' apps / '+stats.minutes+' min':'unavailable'));
 }}
 await Promise.all(Array.from({length:5},worker));if(!rows.some(r=>['apps','minutes','goals','assists'].some(k=>r[k]!==null)))throw Error('No current-season totals verified; preserving snapshot');
 rows.sort((a,b)=>a.player_id.localeCompare(b.player_id)||a.league.localeCompare(b.league));const snapshot={updated_at:now.toISOString(),season,definition:'Source-published domestic league season totals; FotMob uses the listed club. Sofascore is an independently sourced fallback. Each tuple retains its own provider. Missing values are not assumed to be zero.',rows,errors};
 fs.writeFileSync('season-totals.json',JSON.stringify(snapshot,null,2)+'\n');const file='japanese-players.html',current=fs.readFileSync(file,'utf8'),currentSeed=JSON.parse(current.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);currentSeed.season_totals_snapshot=snapshot;fs.writeFileSync(file,current.replace(/(<script[^>]*id="seed"[^>]*>)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(currentSeed).replace(/</g,'\\u003c')+b));
 console.log('Saved '+rows.filter(r=>r.apps!==null&&r.minutes!==null&&r.goals!==null&&r.assists!==null).length+' complete season totals / '+rows.length+' affiliations');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
