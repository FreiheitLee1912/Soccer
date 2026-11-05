const fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test'),assert=require('node:assert/strict');
const html=fs.readFileSync('japanese-players.html','utf8');
function page(){
 const seed=JSON.parse(html.match(/id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
 const base=seed.players[0];
 seed.players=[['a',1,'Premier League'],['b',1,'Premier League'],['c',2,'Bundesliga'],['moved',9,'Bundesliga']].map(([id,club,league])=>({...base,player_id:id,name_en:id,name_ja:id,club:'Club '+club,club_id:club,league,affiliations:undefined}));
 seed.leagues=[['Premier League',47,39,'Europe/London'],['Bundesliga',54,78,'Europe/Berlin']];
 seed.competition_eligibility=[{player_id:'a',club_id:1,competition:'Champions League',eligible:true,valid_from:'2026-09-01',valid_until:'2027-01-31',source_url:'https://example.com/squad'},{player_id:'b',club_id:1,competition:'Champions League',eligible:false,valid_from:'2026-09-01',valid_until:'2027-01-31',source_url:'https://example.com/squad'}];
 const record=(player,club,name,type)=>({player_id:player,club_id:club,club:'Club '+club,league:name,competition:name,competition_type:type,domestic_league:type==='cup'?'Premier League':undefined,match_id:name,source_url:'https://example.com/match',kickoff_local:'2026-11-05T20:00:00+00:00',home:'Home',away:'Away',home_id:1,away_id:2,home_goals:1,away_goals:0,status:'Started',minutes:90,goals:0,assists:0});
 seed.records=[record('a',1,'FA Cup','cup'),record('a',1,'Premier League','league'),record('c',2,'Europa League','cup'),record('moved',1,'FA Cup','cup')];
 seed.weekly_snapshot={records:[]};
 const fixture=(name,id,type,club=1)=>({club_id:club,competition:name,competition_id:id,competition_type:type,source_url:'https://example.com/fixture',kickoff_local:'2026-11-05T20:00:00+00:00',kickoff_utc:'2026-11-05T20:00:00Z',home:'Home',away:'Away',home_id:club,away_id:8,status:'Scheduled'});
 seed.fixture_snapshot={updated_at:'2026-11-05T00:00:00Z',fixtures:[fixture('FA Cup',198,'cup'),fixture('FA Cup',198,'cup'),fixture('Champions League',42,'cup'),fixture('Premier League',47,'league'),fixture('DFB Pokal',209,'cup',2)]};
 const elements={};
 const document={getElementById(id){return elements[id]||={value:'',innerHTML:'',textContent:id==='seed'?JSON.stringify(seed):'',addEventListener(){},setAttribute(){},classList:{toggle(){}}}},querySelectorAll(){return[]}};
 const ctx=vm.createContext({document,location:{protocol:'file:'},window:{},console,URL,Blob});
 vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1],ctx);
 vm.runInContext("$('week').value='2026-W45';render()",ctx);
 return {ctx,elements,run:code=>vm.runInContext(code,ctx)};
}
test('navigation separates European and domestic cups, including fixture-only competitions',()=>{
 const {elements}=page(),nav=elements.leagues.innerHTML;
 assert.match(nav,/European Cups/);assert.match(nav,/Domestic Cups/);
 for(const id of [42,73,525,198,209])assert.ok(nav.includes('data-league="cup:'+id+'"'),String(id));
 assert.ok(nav.indexOf('European Cups')<nav.indexOf('data-league="cup:42"'));
 assert.ok(nav.indexOf('Domestic Cups')<nav.indexOf('data-league="cup:198"'));
 assert.equal((nav.match(/data-league="cup:73"/g)||[]).length,1);
 assert.ok(!nav.includes('data-league="Europa League"'));
 assert.ok(!nav.includes('data-league="FA Cup"'));
});
test('cup counts use unique current players, exclude old clubs and unregistered UEFA players',()=>{
 const {run}=page();
 assert.equal(run("players.filter(p=>playerInCompetition(p,'FA Cup')).length"),2);
 assert.equal(run("players.filter(p=>playerInCompetition(p,'Champions League')).map(p=>p.player_id).join(',')"),'a');
 assert.equal(run("playerInCompetition(players.find(p=>p.player_id==='moved'),'FA Cup')"),false);
});
test('cup selection filters summary records and fixtures to that competition',()=>{
 const {run,elements}=page();run("league='cup:198';render()");
 assert.equal(run("filtered().map(x=>x.p.player_id).join(',')"),'a,b');
 assert.equal(run("filtered().flatMap(x=>x.rs).every(r=>r.league==='FA Cup')"),true);
 assert.equal(run("scheduledRows().every(x=>x.f.competition==='FA Cup')"),true);
 assert.ok(run('scheduledRows().length')>0);
 assert.match(elements.content.innerHTML,/FA Cup/);
 assert.doesNotMatch(elements.content.innerHTML,/<h2>Premier League<\/h2>/);
 assert.match(elements['fixture-missing-label'].textContent,/^0 players/);
});
test('European cup selection keeps fixture registration checks and valid affiliations',()=>{
 const {run}=page();run("league='Champions League';render()");
 assert.equal(run("scheduledRows().map(x=>x.p.player_id).join(',')"),'a');
 run("seed.competition_eligibility.push({...seed.competition_eligibility[0],eligible:false})");
 assert.equal(run('scheduledRows().length'),0);
});
test('league and all-leagues selections retain their existing cup-inclusive behavior',()=>{
 const {run}=page();run("league='Premier League';render()");
 assert.equal(run("filtered().map(x=>x.p.player_id).join(',')"),'a,b');
 assert.equal(run("filtered().flatMap(x=>x.rs).map(r=>r.league).join(',')"),'FA Cup,Premier League');
 run("league='All leagues'");assert.equal(run('schedulePlayers().length'),4);
 assert.equal(run("recordInLeague({league:'FA Cup',domestic_league:'Premier League'},'Premier League')"),true);
});
test('cup selection preserves domestic season totals, ratings and season activity filters',()=>{
 const {run}=page();
 run("totalsData={rows:[{player_id:'a',club_id:1,league:'Premier League',apps:10,minutes:600,goals:2,assists:1}]};sofascoreData={rows:[{player_id:'a',club_id:1,league:'Premier League',rating:7.2,rated_matches:5}]};league='FA Cup'");
 assert.equal(run("seasonTotalValue(players[0],'apps')"),10);
 assert.equal(run('seasonRatingValue(players[0])'),7.2);
 run("mode='appeared'");assert.equal(run("filtered().map(x=>x.p.player_id).join(',')"),'a');
 run("mode='contrib'");assert.equal(run("filtered().map(x=>x.p.player_id).join(',')"),'a');
});
test('same-named national cups retain distinct IDs and separate players and fixtures',()=>{
 const {run,elements}=page();
 run("fixtureData.fixtures.push({...fixtureData.fixtures[0],competition:'Cup',competition_id:278},{...fixtureData.fixtures[0],competition:'Cup',competition_id:164,club_id:2});render()");
 assert.ok(elements.leagues.innerHTML.includes('data-league="cup:278"'));
 assert.ok(elements.leagues.innerHTML.includes('data-league="cup:164"'));
 run("league='cup:278';render()");
 assert.equal(run("filtered().map(x=>x.p.player_id).join(',')"),'a,b');
 assert.equal(run('scheduledRows().every(x=>x.f.competition_id===278)'),true);
 assert.equal(run('scheduledRows().length'),2);
 run("league='cup:164';render()");assert.equal(run("filtered().map(x=>x.p.player_id).join(',')"),'c');
});
test('expired positive UEFA evidence cannot override an applicable negative registration',()=>{
 const {run}=page();
 run("const today=new Date().toISOString().slice(0,10);fixtureData.fixtures=fixtureData.fixtures.filter(f=>f.competition!=='Champions League');seed.competition_eligibility=[{...seed.competition_eligibility[0],valid_from:'2020-01-01',valid_until:'2020-01-02'},{...seed.competition_eligibility[0],eligible:false,valid_from:today,valid_until:'2099-01-01'}]");
 assert.equal(run("playerInCompetition(players[0],'Champions League')"),false);
});
