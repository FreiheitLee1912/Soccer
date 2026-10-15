// Positive registration evidence gates both UEFA previews and team results.
const fs=require('node:fs');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const run=promisify(execFile);
const {competitions,parseSquad,decode,normalize}=require('./uefa-registration.cjs');const {affiliations}=require('./completed-matches.cjs');
const file='japanese-players.html',html=fs.readFileSync(file,'utf8'),seed=JSON.parse(html.match(/id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
const aliases={'PSV Eindhoven':'PSV','Slovan Bratislava':'S. Bratislava','Union St.Gilloise':'Union SG','Jagiellonia Białystok':'Jagiellonia'};
async function page(url){return(await run('curl',['-f','-L','-s','--max-time','30','--retry','1',url],{maxBuffer:5*1024*1024})).stdout}
async function main(){const now=new Date(),day=now.toISOString().slice(0,10),year=now.getUTCFullYear()-(now.getUTCMonth()<6?1:0),season=year+'/'+String(year+1).slice(2),records=[],errors=[];
 for(const c of competitions){const directory=await page(`https://www.uefa.com/${c.slug}/clubs/`);const clubs=[...directory.matchAll(/<a href="\/[^" ]+\/clubs\/(\d+)--[^" ]+\/" class="team-wrap" title="([^"]+)"/g)].map(m=>({id:m[1],name:decode(m[2])}));if(!clubs.length)throw Error('UEFA club directory unavailable');
  const groups=new Map();for(const p of seed.players)for(const a of affiliations(p)){const club=clubs.find(t=>normalize(t.name)===normalize(aliases[a.club]||a.club));if(!club)continue;const key=String(a.club_id);if(!groups.has(key))groups.set(key,{club,players:[]});groups.get(key).players.push({p,a})}
  for(const [clubId,g]of groups){const url=`https://www.uefa.com/${c.slug}/clubs/${g.club.id}/squad/`;try{const squad=parseSquad(await page(url),c.name,season);for(const {p}of g.players){const found=squad.filter(x=>x.country==='JPN'&&normalize(x.name)===normalize(p.name_en));if(found.length>1)throw Error('Ambiguous UEFA player identity');records.push({player_id:p.player_id,name_ja:p.name_ja,club_id:Number(clubId),competition:c.name,eligible:found.length===1,valid_from:day,valid_until:`${year+1}-06-30`,season,phase:'Published UEFA squad',checked_at:day,source_url:url,uefa_player_id:found[0]?.id||null,list:found[0]?.list||null,reason:found.length?'Listed in UEFA competition squad (List '+found[0].list+').':'Not listed in the published UEFA competition squad.'})}console.log(c.name+' · '+g.club.name+' · checked')}catch(e){errors.push({club_id:clubId,competition:c.name,error:e.message});console.error(g.club.name+': '+e.message)}}
 }
 if(!records.length)throw Error('No UEFA squads verified; preserving snapshot');
 // Keep previous evidence for earlier dates. New checks supersede it from today.
 const keys=new Set(records.map(r=>r.player_id+':'+r.club_id+':'+r.competition));const yesterday=new Date(now);yesterday.setUTCDate(yesterday.getUTCDate()-1);const end=yesterday.toISOString().slice(0,10);
 const old=(seed.competition_eligibility||[]).flatMap(r=>{if(!keys.has(r.player_id+':'+r.club_id+':'+r.competition))return[r];if(r.valid_from>=day)return[];return[{...r,valid_until:r.valid_until<end?r.valid_until:end}]});
 seed.competition_eligibility=[...old,...records];seed.competition_eligibility_updated_at=now.toISOString();seed.competition_eligibility_errors=errors;
 fs.writeFileSync(file,html.replace(/(<script[^>]*id="seed"[^>]*>)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(seed).replace(/</g,'\\u003c')+b));console.log('Saved '+records.length+' UEFA registration checks; '+errors.length+' source gaps');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
