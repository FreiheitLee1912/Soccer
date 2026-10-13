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
