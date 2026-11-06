const {test}=require('node:test'),assert=require('node:assert/strict');
const {matchEvidence,reconcilePlayer}=require('../match-evidence.cjs');
const {validateRecords}=require('../report-quality.cjs');
const {verifySnapshot}=require('../verify-report-data.cjs');
const empty={goals:null,assists:null,own_goals:null,yellow_cards:null,red_cards:null};
function data(events,score=[1,0]){return {header:{teams:score.map(score=>({score}))},content:{matchFacts:{events:{events}}}}}
function goal(id=1){return {type:'Goal',eventId:101,playerId:id,assistPlayerId:2,time:90,overloadTime:2,newScore:[1,0]}}
test('goal and assist event evidence recovers lagging zeros independently',()=>{
 const e=matchEvidence(data([goal()]));
 assert.equal(reconcilePlayer({...empty,goals:0},{id:1},e,'https://source').goals,1);
 assert.equal(reconcilePlayer({...empty,assists:0},{id:2},e,'https://source').assists,1);
});
test('a larger conflicting statistic is withheld, never selected with max',()=>{
 const r=reconcilePlayer({...empty,goals:2},{id:1},matchEvidence(data([goal()])),'https://source');
 assert.equal(r.goals,null);assert.equal(r.quality_issues[0].stat_value,2);assert.equal(r.quality_issues[0].event_value,1);
});
test('goal statistic without a scorer in a complete timeline is held for review',()=>{
 const r=reconcilePlayer({...empty,goals:1},{id:3},matchEvidence(data([goal()])),'https://source');
 assert.equal(r.goals,null);assert.equal(r.quality_issues[0].event_value,0);
});
test('incomplete, reversed and cancelled score progressions cannot fabricate contributions',()=>{
 for(const events of [[{...goal(),newScore:[2,0]}],[{...goal(),newScore:[0,0]}],[goal(),{...goal(),eventId:102,newScore:[0,0]}]]){
  const r=reconcilePlayer(empty,{id:1},matchEvidence(data(events)),'https://source');assert.equal(r.goals,null);
 }
});
test('own goals and shootout goals are not ordinary goals or assists',()=>{
 const e=matchEvidence(data([{...goal(),ownGoal:true}]));
 assert.equal(reconcilePlayer(empty,{id:1},e,'https://source').own_goals,1);
 assert.equal(reconcilePlayer(empty,{id:1},e,'https://source').goals,null);
 assert.equal(reconcilePlayer(empty,{id:2},e,'https://source').assists,null);
 assert.equal(matchEvidence(data([{...goal(),isPenaltyShootoutEvent:true}])).complete,false);
});
test('two yellows including a second-yellow dismissal yield two yellows and one red',()=>{
 const events=[{type:'Card',eventId:1,playerId:7,card:'Yellow',time:54},{type:'Card',eventId:2,playerId:7,card:'YellowRed',time:90}];
 const r=reconcilePlayer(empty,{id:7},matchEvidence(data([...events,events[1]],[0,0])),'https://source');
 assert.equal(r.yellow_cards,2);assert.equal(r.red_cards,1);assert.equal(r.goals,null);
});
test('absence of all events never creates a zero statistic',()=>{
 const r=reconcilePlayer(empty,{id:1},matchEvidence(data([],[0,0])),'https://source');
 for(const k of Object.keys(empty))assert.equal(r[k],null);
});
const row={match_id:'1',player_id:'p',source_url:'https://www.fotmob.com/matches/test#1',kickoff_local:'2026-11-05T18:45:00',home_id:1,away_id:2,club_id:1,home_goals:1,away_goals:0,status:'Started',minutes:90,goals:1,assists:0,rating:8};
test('publication rejects duplicate identities, impossible statistics and unconfirmed zeros',()=>{
 for(const rows of [[row,row],[{...row,goals:2}],[{...row,assists:2}],[{...row,rating:11}],[{...row,status:'Matchday selection unconfirmed'}],[{...row,source_url:''}],[row,{...row,player_id:'q',home_goals:2}]])assert.ok(validateRecords(rows).length);
 assert.deepEqual(validateRecords([row]),[]);
 const unconfirmed={...row,status:'Matchday selection unconfirmed',minutes:null,goals:null,assists:null,rating:null};assert.deepEqual(validateRecords([unconfirmed]),[]);
});
test('unresolved conflicts require blank output and retained source evidence',()=>{
 const issue={field:'goals',source_url:row.source_url};
 assert.ok(validateRecords([{...row,quality_issues:[issue]}]).length);
 assert.deepEqual(validateRecords([{...row,goals:null,quality_issues:[issue]}]),[]);
});
test('publication rejects contribution totals across teammates and mismatched event counts',()=>{
 assert.ok(validateRecords([row,{...row,player_id:'q'}]).length);
 assert.ok(validateRecords([{...row,event_evidence:{goals:{source_url:row.source_url,events:[{event_id:1},{event_id:2}]}}}]).length);
});
test('Nakayama real-match regression: three final goals include the 90+2 winner despite zero in stats',()=>{
 const e=matchEvidence(data([{...goal(2070984),eventId:14696482,newScore:[0,1],assistPlayerId:1101127},{...goal(1369195),eventId:14696715,newScore:[1,1],assistPlayerId:438456},{...goal(541513),eventId:14696847,newScore:[2,1],assistPlayerId:null}],[2,1]));
 const r=reconcilePlayer({...empty,goals:0},{id:541513},e,'https://www.fotmob.com/matches/fk-crvena-zvezda-vs-inter-club-descaldes/2wirlk#6112410');
 assert.equal(r.goals,1);assert.equal(r.event_evidence.goals.events[0].event_id,14696847);
});
test('publication coverage cannot drop, double-count or leave a completed fixture pending',()=>{
 const snapshot={records:[row],checked_matches:1,coverage:{clubs:[],matches:[{match_id:'1',status:'recorded',player_records:1,source_url:row.source_url}]}};
 assert.equal(verifySnapshot(snapshot),true);
 for(const broken of [{...snapshot,checked_matches:2},{...snapshot,coverage:{...snapshot.coverage,matches:[]}},{...snapshot,coverage:{...snapshot.coverage,matches:[{...snapshot.coverage.matches[0],status:'pending'}]}}])assert.throws(()=>verifySnapshot(broken));
});
test('the actual publication command exits unsuccessfully on invalid data',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jpa-publication-gate-'));
 try{
  const snapshot={records:[row,row],updated_at:'2026-11-06T00:00:00Z'};
  fs.writeFileSync(path.join(dir,'weekly-records.json'),JSON.stringify(snapshot));
  fs.writeFileSync(path.join(dir,'japanese-players.html'),'<script id="seed">'+JSON.stringify({weekly_snapshot:snapshot})+'</script>');
  const result=spawnSync(process.execPath,[require.resolve('../verify-report-data.cjs')],{cwd:dir,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Duplicate match\/player/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
