const fs=require('node:fs');const {execFile}=require('node:child_process');const {promisify}=require('node:util');const run=promisify(execFile);
async function main(){
 const data=JSON.parse(fs.readFileSync('fixtures.json','utf8'));
 const matches=[...new Map(data.fixtures.map(f=>[f.match_id,f])).values()].sort((a,b)=>Date.parse(a.kickoff_utc)-Date.parse(b.kickoff_utc));
 const existing=fs.existsSync('fixture-venues.json')?JSON.parse(fs.readFileSync('fixture-venues.json','utf8')).venues:[];
 const venues=[],errors=[];let index=0;
 async function worker(){while(index<matches.length){const f=matches[index++];try{
  const {stdout}=await run('curl',['-f','-L','-s','--max-time','25','--retry','1',f.source_url],{maxBuffer:12*1024*1024});
  const m=stdout.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);if(!m)throw Error('Missing match source');
  const p=JSON.parse(m[1]).props.pageProps;
  if(String(p.general?.matchId)!==f.match_id)throw Error('Match identity mismatch');
  const stadium=p.content?.matchFacts?.infoBox?.Stadium;
  const old=existing.find(v=>v.match_id===f.match_id);
  venues.push(stadium?.name?{match_id:f.match_id,city:stadium.city||null,stadium:stadium.name,country:stadium.country,source_url:f.source_url,checked_at:new Date().toISOString()}:old||{match_id:f.match_id,city:null,stadium:null,source_url:f.source_url,checked_at:new Date().toISOString()});
  console.log('Venue '+f.match_id+' '+(stadium?.name||'TBC'));
 }catch(e){errors.push({match_id:f.match_id,error:e.message});const old=existing.find(v=>v.match_id===f.match_id);if(old)venues.push(old);console.error('Venue unavailable '+f.match_id)}}}
 await Promise.all(Array.from({length:6},worker));
 if(!venues.length)throw Error('No venue records retrieved; preserving previous snapshot');
 const snapshot={updated_at:new Date().toISOString(),venues,errors};fs.writeFileSync('fixture-venues.json',JSON.stringify(snapshot,null,2)+'\n');
 const file='japanese-players.html',html=fs.readFileSync(file,'utf8'),seed=JSON.parse(html.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);seed.venue_snapshot=snapshot;
 fs.writeFileSync(file,html.replace(/(<script[^>]*id="seed"[^>]*>)[\s\S]*?(<\/script>)/,(_,a,b)=>a+JSON.stringify(seed).replace(/</g,'\\u003c')+b));
 console.log(`Saved ${venues.filter(v=>v.stadium).length} confirmed venues / ${matches.length} matches`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
