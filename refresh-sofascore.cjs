const fs=require('node:fs');const {execFile}=require('node:child_process');const {promisify}=require('node:util');
const {resolvePlayer,selectSeason,readRating}=require('./sofascore-season.cjs');const run=promisify(execFile);
const html=fs.readFileSync('japanese-players.html','utf8'),seed=JSON.parse(html.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
const now=new Date(),year=now.getUTCFullYear()-(now.getUTCMonth()<6?1:0),seasonYear=String(year).slice(2)+'/'+String(year+1).slice(2);
let sourceBlocked=false;
const leagueSeason=league=>['Latvian Virsliga','Kazakhstan Premier League'].includes(league)?String(now.getUTCFullYear()):seasonYear;
async function get(path){if(sourceBlocked)throw Error('Source temporarily unavailable');const {stdout}=await run('curl',['-f','-L','-s','--max-time','25','https://www.sofascore.com/api/v1'+path],{maxBuffer:4*1024*1024});const d=JSON.parse(stdout);if(d.error){if(d.error.code===403)sourceBlocked=true;throw Error('Source returned an error')}return d}
async function main(){
 const rows=[],errors=[];let index=0;
 const previous=fs.existsSync('sofascore-season.json')?JSON.parse(fs.readFileSync('sofascore-season.json','utf8')).rows:[];
 async function worker(){while(index<seed.players.length){const p=seed.players[index++],aff=typeof p.affiliations==='string'?JSON.parse(p.affiliations):p.affiliations||[p];try{
  const search=await get('/search/all?q='+encodeURIComponent(p.name_en));
  if(!Array.isArray(search.results))throw Error('Invalid search response');
  const player=resolvePlayer(search.results,p.name_en,p.club);
  if(!player){for(const a of aff)rows.push({player_id:p.player_id,club_id:a.club_id,league:a.league,season:leagueSeason(a.league),rating:null,rated_matches:null,status:'Identity not confirmed',checked_at:now.toISOString()});console.log('Unmatched '+p.name_en);continue}
  const seasons=await get(`/player/${player.id}/statistics/seasons`),source=`https://www.sofascore.com/football/player/${player.slug}/${player.id}`;
  if(!Array.isArray(seasons.uniqueTournamentSeasons))throw Error('Invalid seasons response');
  const playerRows=[];
  for(const a of aff){const selected=selectSeason(seasons.uniqueTournamentSeasons,a.league,leagueSeason(a.league));
   if(selected.length!==1){playerRows.push({player_id:p.player_id,club_id:a.club_id,league:a.league,season:leagueSeason(a.league),rating:null,rated_matches:null,status:'No verified current-season league rating',sofascore_player_id:player.id,source_url:source,checked_at:now.toISOString()});continue}
   const {tournament,season}=selected[0],api=`/player/${player.id}/unique-tournament/${tournament.id}/season/${season.id}/statistics/overall`;
   const data=await get(api);if(!data.statistics||data.error)throw Error('Invalid statistics response');const rating=readRating(data.statistics);
   playerRows.push({player_id:p.player_id,club_id:a.club_id,league:a.league,season:leagueSeason(a.league),rating:rating?.rating??null,rated_matches:rating?.rated_matches??null,status:rating?'Verified season league average':'No rated appearances',sofascore_player_id:player.id,tournament_id:tournament.id,season_id:season.id,tournament_name:tournament.name,source_url:source,statistics_url:'https://www.sofascore.com/api/v1'+api,checked_at:now.toISOString()});
  }
  rows.push(...playerRows);console.log('Checked '+p.name_en);
 }catch(e){errors.push({player_id:p.player_id,error:e.message});for(const a of aff){const old=previous.find(r=>r.player_id===p.player_id&&String(r.club_id)===String(a.club_id)&&r.league===a.league&&r.season===leagueSeason(a.league));rows.push(old?{...old,status:old.rating!==null?'Saved verified rating (refresh failed)':'Refresh unavailable'}:{player_id:p.player_id,club_id:a.club_id,league:a.league,season:leagueSeason(a.league),rating:null,rated_matches:null,status:'Refresh unavailable',checked_at:now.toISOString()})}console.error('Failed '+p.name_en)}
 }}
 await Promise.all(Array.from({length:3},worker));
 if(errors.length===seed.players.length)throw Error('All source checks failed; preserving snapshot');
 rows.sort((a,b)=>a.player_id.localeCompare(b.player_id)||a.league.localeCompare(b.league));
 const snapshot={updated_at:now.toISOString(),season:seasonYear,definition:'Published Sofascore average rating in the listed domestic league and season. Not the weekly FotMob rating. Missing or older-season values are not substituted.',rows,errors};
 fs.writeFileSync('sofascore-season.json',JSON.stringify(snapshot,null,2)+'\n');seed.sofascore_snapshot=snapshot;
 fs.writeFileSync('japanese-players.html',html.replace(/(<script[^>]*id="seed"[^>]*>)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(seed).replace(/</g,'\\u003c')+b));
 console.log(`Saved ${rows.filter(r=>r.rating!==null).length} ratings / ${rows.length} affiliations; ${errors.length} source failures`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
