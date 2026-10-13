const {test}=require('node:test');const assert=require('node:assert/strict');
const {resolvePlayer,selectSeason,readRating}=require('../sofascore-season.cjs');
test('identity requires an exact normalized name and Japanese nationality',()=>{
  const team={sport:{slug:'football'}};
  assert.equal(resolvePlayer([{type:'player',entity:{id:1,name:'Zion Suzuki',country:{alpha2:'JP'},team}}],'Zion Suzuki').id,1);
  assert.equal(resolvePlayer([{type:'player',entity:{id:1,name:'Zion Suzuki',country:{alpha2:'US'},team}}],'Zion Suzuki'),null);
});
test('football and current club distinguish people with the same name',()=>{
 const results=[{type:'player',entity:{id:1,name:'Hiroki Itō',country:{alpha2:'JP'},team:{name:'FC Bayern München',sport:{slug:'football'}}}},{type:'player',entity:{id:2,name:'Hiroki Ito',country:{alpha2:'JP'},team:{name:'No team',sport:{slug:'football'}}}}];
 assert.equal(resolvePlayer(results,'Hiroki Ito','Bayern München').id,1);
 assert.equal(resolvePlayer([{type:'player',entity:{id:2,name:'Koki Saito',country:{alpha2:'JP'},team:{name:'Chunichi Dragons',sport:{slug:'baseball'}}}}],'Koki Saito'),null);
});
test('same-named tournaments in other countries and old seasons are excluded',()=>{
  const t=[{uniqueTournament:{name:'Premier League',category:{name:'England'}},seasons:[{year:'25/26',id:1},{year:'26/27',id:2}]},{uniqueTournament:{name:'Premier League',category:{name:'Armenia'}},seasons:[{year:'26/27',id:3}]}];
  assert.deepEqual(selectSeason(t,'Premier League','26/27').map(x=>x.season.id),[2]);
  assert.deepEqual(selectSeason(t,'Premier League','27/28'),[]);
});
test('zero rated matches and missing ratings do not become a season rating',()=>{
  assert.equal(readRating({rating:0,countRating:0}),null);
  assert.equal(readRating({rating:7,countRating:0}),null);
  assert.equal(readRating({countRating:3}),null);
  assert.deepEqual(readRating({rating:6.86,countRating:5}),{rating:6.86,rated_matches:5});
});
