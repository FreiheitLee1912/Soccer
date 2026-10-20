const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('japanese-players.html', 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const seed = JSON.parse(html.match(/<script[^>]*id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]);
const elements = {};
const document = {getElementById(id){return elements[id] ||= {value:'',innerHTML:'',textContent:id==='seed'?JSON.stringify(seed):'',addEventListener(){},setAttribute(){},classList:{toggle(){}}}},querySelectorAll(){return []}};
const ctx = vm.createContext({document,location:{protocol:'file:'},window:{},console,URL,Blob});
vm.runInContext(script,ctx);
test('Monday belongs to the preceding Sunday; Friday and Sunday share the week',()=>{
  for (const d of ['2026-10-09','2026-10-11','2026-10-12']) assert.equal(vm.runInContext(`reportWeek('${d}T20:00:00+02:00')`,ctx),'2026-W41');
});
test('Tuesday through Thursday belong to the upcoming Sunday',()=>{
  for (const d of ['2026-10-13','2026-10-14','2026-10-15']) assert.equal(vm.runInContext(`reportWeek('${d}T20:00:00+02:00')`,ctx),'2026-W42');
});
test('local kickoff date wins over JST and UTC dates',()=>{
  assert.equal(vm.runInContext("reportWeek('2026-10-12T23:30:00+01:00')",ctx),'2026-W41');
});
test('weekend spans Friday to Monday across year boundary',()=>{
  assert.equal(vm.runInContext("weekendRange('2026-W42').map(d=>d.toISOString().slice(0,10)).join(',')",ctx),'2026-10-16,2026-10-19');
  assert.equal(vm.runInContext("reportWeek('2027-01-04T20:00:00+01:00')",ctx),'2026-W53');
});
test('loaded records are regrouped, not trusted by their old CSV week',()=>{
  assert.equal(vm.runInContext("records.find(r=>r.match_id==='5795468').week",ctx),'2026-W41');
});
test('scheduled fixtures are sorted by kickoff across leagues and respect player search',()=>{
  vm.runInContext(`fixtureData={updated_at:'2026-10-13',fixtures:[
    {match_id:'later',club_id:9826,kickoff_local:'2026-10-18T14:00:00',kickoff_utc:'2026-10-18T13:00:00Z'},
    {match_id:'earlier',club_id:9826,kickoff_local:'2026-10-15T18:45:00',kickoff_utc:'2026-10-15T16:45:00Z'}]}`,ctx);
  elements.week.value='2026-W42';elements.search.value='Kamada';
  assert.equal(vm.runInContext("scheduledRows().map(x=>x.f.match_id).join(',')",ctx),'earlier,later');
  elements.search.value='';
});
test('weekly CSV contains Monday in W41 and excludes it from W42',async()=>{
  vm.runInContext("updateWeeklyDownload('2026-W41')",ctx);
  const csv=await (await fetch(elements.csvlink.href)).text();
  assert.ok(csv.includes('5795468'));
  assert.ok(csv.includes('"2026-W41"'));
  vm.runInContext("updateWeeklyDownload('2026-W42')",ctx);
  assert.ok(!(await (await fetch(elements.csvlink.href)).text()).includes('5795468'));
});
test('unknown local kickoff does not invent a reporting week',()=>{
  assert.equal(vm.runInContext("reportWeek('')",ctx),null);
  assert.equal(vm.runInContext("reportWeek('2026-02-30T20:00:00')",ctx),null);
});
test('Endo is excluded from Champions League fixtures but retains domestic fixtures',()=>{
  vm.runInContext(`fixtureData={updated_at:'2026-10-13',fixtures:[
    {match_id:'endo-domestic',club_id:8650,competition:'Premier League',kickoff_local:'2026-10-17T15:00:00',kickoff_utc:'2026-10-17T14:00:00Z'},
    {match_id:'endo-europe',club_id:8650,competition:'Champions League',kickoff_local:'2026-10-14T20:00:00',kickoff_utc:'2026-10-14T19:00:00Z'},
    {match_id:'endo-cup',club_id:8650,competition:'EFL Cup',kickoff_local:'2026-10-28T20:00:00',kickoff_utc:'2026-10-28T20:00:00Z'}]}`,ctx);
  elements.search.value='Endo';elements.week.value='2026-W42';
  const competitions=JSON.parse(vm.runInContext('JSON.stringify(scheduledRows().map(x=>x.f.competition))',ctx));
  assert.ok(competitions.includes('Premier League'));
  assert.ok(!competitions.includes('Champions League'));
  elements.week.value='2026-W44';
  assert.ok(vm.runInContext("scheduledRows().some(x=>x.f.competition==='EFL Cup')",ctx));
  elements.search.value='';
});
test('summary shows separate season Sofascore rating without weekly match records',()=>{
  const savedRecords=vm.runInContext('records',ctx);
  vm.runInContext('records=[]',ctx);
  vm.runInContext(`sofascoreData={season:'26/27',updated_at:'2026-10-13',rows:[{player_id:'fm-1053679',club_id:10252,league:'Premier League',season:'26/27',rating:6.86,rated_matches:5,source_url:'https://www.sofascore.com/football/player/suzuki-zion/905351'}]}`,ctx);
  elements.search.value='Zion Suzuki';elements.week.value='2026-W42';
  vm.runInContext('render()',ctx);
  assert.ok(elements.summary.innerHTML.includes('6.86'));
  assert.ok(elements.summary.innerHTML.includes('Sofascore'));
  assert.ok(elements.summary.innerHTML.includes('5 rated matches'));
  assert.ok(elements.summary.innerHTML.includes('No record yet'));
  ctx.savedRecords=savedRecords;vm.runInContext('records=savedRecords',ctx);
  elements.search.value='';
});
test('fixture location shows actual city and stadium, with an honest missing-venue fallback',()=>{
  vm.runInContext(`venueData={venues:[{match_id:'5836864',city:'Burnley',stadium:'Turf Moor',source_url:'https://www.fotmob.com/matches/burnley-vs-charlton-athletic/2agfba#5836864'}]}`,ctx);
  assert.equal(vm.runInContext("fixtureVenue({match_id:'5836864'})",ctx),'Burnley / Turf Moor');
  assert.equal(vm.runInContext("fixtureVenue({match_id:'unknown',venue_timezone:'Europe/London'})",ctx),'Venue TBC');
});
test('summary uses published season totals and keeps them unchanged across report weeks',()=>{
 vm.runInContext(`sofascoreData={season:'26/27',updated_at:'2026-10-13',rows:[{player_id:'fm-1053679',club_id:10252,league:'Premier League',season:'26/27',rating:6.86,rated_matches:5,apps:6,minutes:450,goals:0,assists:0,source_url:'https://www.sofascore.com/football/player/suzuki-zion/905351'}]};totalsData={rows:sofascoreData.rows}`,ctx);
 elements.search.value='Zion Suzuki';elements.week.value='2026-W42';vm.runInContext('render()',ctx);
 assert.ok(elements.summary.innerHTML.includes('>450</td>'));
 assert.ok(elements.summary.innerHTML.includes('>6</td>'));
 assert.ok(elements.summary.innerHTML.includes('>0</td>'));
 assert.ok(elements.summary.innerHTML.includes('Season stats available'));
 elements.week.value='2026-W41';vm.runInContext('render()',ctx);
 assert.ok(elements.summary.innerHTML.includes('>450</td>'));
 assert.ok(elements.summary.innerHTML.includes('>6</td>'));
 elements.search.value='';
});
test('season appearances filter works in a future report week without weekly appearances',()=>{
 const savedRecords=vm.runInContext('records',ctx);
 vm.runInContext(`records=[];totalsData={rows:[{player_id:'fm-1053679',club_id:10252,league:'Premier League',season:'26/27',apps:6,minutes:450,goals:0,assists:0}]}`,ctx);
 elements.search.value='Zion Suzuki';elements.week.value='2026-W42';vm.runInContext("mode='appeared'",ctx);
 assert.equal(vm.runInContext('filtered().length',ctx),1);
 assert.equal(vm.runInContext('filtered()[0].ps.length',ctx),0);
 ctx.savedRecords=savedRecords;vm.runInContext("records=savedRecords;mode='all'",ctx);elements.search.value='';
});
test('completed-match feed survives CSV refresh and replaces duplicate archived records',()=>{
 const result=JSON.parse(vm.runInContext(`JSON.stringify(mergeMatchRecords([{match_id:'5836864',player_id:'jp-017',league:'EFL Championship',kickoff_local:'2026-10-13T19:45:00',minutes:null}], [{match_id:'5836864',player_id:'jp-017',league:'EFL Championship',kickoff_local:'2026-10-13T19:45:00',minutes:90,rating:7.1}]))`,ctx));
 assert.equal(result.length,1);assert.equal(result[0].minutes,90);assert.equal(result[0].week,'2026-W42');
});

test('UEFA previews require positive registration evidence regardless of matchday selection',()=>{const result=vm.runInContext(`(()=>{const p={player_id:'registered'},f={club_id:123,competition:'Champions League',kickoff_local:'2026-10-21T20:00:00'};const saved=seed.competition_eligibility;try{seed.competition_eligibility=[];if(eligibleForFixture(p,f))return false;seed.competition_eligibility=[{player_id:p.player_id,club_id:123,competition:f.competition,eligible:true,source_url:'https://www.uefa.com/squad/',valid_from:'2026-10-01',valid_until:'2027-01-31'}];return eligibleForFixture(p,f)&&!eligibleForFixture(p,{...f,competition:'Europa League'})&&eligibleForFixture(p,{...f,competition:'Championship'})}finally{seed.competition_eligibility=saved}})()`,ctx);assert.equal(result,true)});

test('European nonparticipant score renders under its competition within the domestic club filter',()=>{const saved=vm.runInContext('records',ctx);try{vm.runInContext(`records=[{match_id:'uefa-result',player_id:'fm-1053679',league:'Champions League',domestic_league:'Premier League',week:'2026-W42',club:'Aston Villa',club_id:10252,home:'Aston Villa',home_id:10252,away:'Viking',away_id:123,home_goals:2,away_goals:1,status:'Not in match squad',kickoff_local:'2026-10-21T20:00:00',source_url:'https://www.fotmob.com/matches/result'}];league='Premier League';mode='all'`,ctx);elements.search.value='Zion Suzuki';elements.week.value='2026-W42';vm.runInContext('render()',ctx);assert.ok(elements.content.innerHTML.includes('Champions League'));assert.ok(elements.content.innerHTML.includes('Not in match squad'));assert.ok(elements.content.innerHTML.includes('2 – 1'));}finally{ctx.savedRecords=saved;vm.runInContext("records=savedRecords;league='All leagues'",ctx);elements.search.value='';}});

test('Atsuki Ito season summary retains verified scoring totals across report weeks',()=>{vm.runInContext(`totalsData={rows:[{player_id:'fm-1227813',club_id:8559,league:'EFL Championship',season:'2026/2027',apps:4,minutes:157,goals:2,assists:0}]};league='EFL Championship';mode='all'`,ctx);elements.search.value='Atsuki Ito';elements.week.value='2026-W42';vm.runInContext('render()',ctx);assert.equal(vm.runInContext("seasonTotalValue(filtered()[0].p,'goals')",ctx),2);assert.ok(elements.summary.innerHTML.includes('>2</td>'));elements.week.value='2026-W43';vm.runInContext('render()',ctx);assert.equal(vm.runInContext("seasonTotalValue(filtered()[0].p,'goals')",ctx),2);elements.search.value='';vm.runInContext("league='All leagues'",ctx)});
test('today schedule uses JST midnight and ignores report-week and player filters',()=>{
  const saved=vm.runInContext('fixtureData',ctx);
  const savedLeague=vm.runInContext('league',ctx),savedSearch=elements.search.value,savedWeek=elements.week.value;
  try {
    vm.runInContext(`fixtureData={updated_at:'2026-10-20',fixtures:[
      {match_id:'before-midnight',club_id:9826,kickoff_utc:'2026-10-19T14:59:00Z'},
      {match_id:'at-midnight',club_id:9826,kickoff_utc:'2026-10-19T15:00:00Z'},
      {match_id:'last-minute',club_id:9826,kickoff_utc:'2026-10-20T14:59:00Z'},
      {match_id:'tomorrow',club_id:9826,kickoff_utc:'2026-10-20T15:00:00Z'}]};league='Nonexistent league'`,ctx);
    elements.search.value='nonexistent player';elements.week.value='2026-W01';
    assert.equal(vm.runInContext("[...new Set(todayRows(new Date('2026-10-20T03:00:00Z')).map(x=>x.f.match_id))].join(',')",ctx),'at-midnight,last-minute');
    assert.ok(html.indexOf('id="today-panel"')<html.indexOf('id="stats"'));
  } finally {
    ctx.savedFixtureData=saved;ctx.savedLeague=savedLeague;
    vm.runInContext('fixtureData=savedFixtureData;league=savedLeague',ctx);
    elements.search.value=savedSearch;elements.week.value=savedWeek;
  }
});
