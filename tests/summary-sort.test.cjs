const fs=require('node:fs'),vm=require('node:vm');const {test}=require('node:test'),assert=require('node:assert/strict');
const html=fs.readFileSync('japanese-players.html','utf8'),seed=JSON.parse(html.match(/id="seed"[^>]*>([\s\S]*?)<\/script>/)[1]),elements={};
const document={getElementById(id){return elements[id]||={value:'',innerHTML:'',textContent:id==='seed'?JSON.stringify(seed):'',addEventListener(){},setAttribute(){},classList:{toggle(){}}}},querySelectorAll(){return[]}};
const ctx=vm.createContext({document,location:{protocol:'file:'},window:{},console,URL,Blob});vm.runInContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1],ctx);
test('numeric columns sort both ways and missing totals always remain last',()=>{
 const result=JSON.parse(vm.runInContext(`JSON.stringify((()=>{totalsData={rows:[{player_id:'a',club_id:1,league:'Premier League',apps:10,minutes:675,goals:2,assists:1},{player_id:'b',club_id:1,league:'Premier League',apps:4,minutes:157,goals:0,assists:0}]};const items=['a','b','missing'].map(id=>({p:{player_id:id,club_id:1,club:'Test',league:'Premier League',name_en:id,name_ja:id},rating:id==='missing'?null:id==='a'?7:6}));return ['apps','minutes','goals','assists','rating'].map(key=>[sortSummary([...items],key,'desc').map(x=>x.p.player_id),sortSummary([...items],key,'asc').map(x=>x.p.player_id)])})())`,ctx));
 for(const [desc,asc]of result){assert.deepEqual(desc,['a','b','missing']);assert.deepEqual(asc,['b','a','missing'])}
});
test('selecting a numeric header starts descending and repeated clicks reverse the direction',()=>{
 vm.runInContext("setSummarySort('goals')",ctx);assert.equal(elements.sort.value,'goals');assert.equal(vm.runInContext('summarySortDirection',ctx),'desc');vm.runInContext("setSummarySort('goals')",ctx);assert.equal(vm.runInContext('summarySortDirection',ctx),'asc');vm.runInContext("setSummarySort('assists')",ctx);assert.equal(vm.runInContext('summarySortDirection',ctx),'desc');
});
test('name ordering is alphabetical and contribution sorting does not invent missing totals',()=>{
 const result=JSON.parse(vm.runInContext(`JSON.stringify((()=>{const items=[{p:{name_ja:'Z',name_en:'Z'}},{p:{name_ja:'A',name_en:'A'}}];return sortSummary(items,'name','asc').map(x=>x.p.name_ja)})())`,ctx));assert.deepEqual(result,['A','Z']);
 assert.equal(vm.runInContext("summarySortValue({p:{player_id:'unknown',club_id:1,league:'Premier League'}},'contribution')",ctx),null);
});

test('status ordering follows the displayed season status rather than weekly participation',()=>{assert.equal(vm.runInContext("summarySortValue({p:{player_id:'unknown',club_id:1,league:'Premier League'},status:'Appeared'},'status')",ctx),'Season stats pending')});
