const {test}=require('node:test');const assert=require('node:assert/strict');
const {readLeagueStat,readPublishedZero,trustedSavedTotals}=require('../fotmob-season-totals.cjs');
const table=(stat,rows)=>({TopLists:[{StatName:stat,StatList:rows}]});
test('Matsuki season goals come from the scoring table, not the squad placeholder zero',()=>{
 const squad={id:1336906,goals:0,assists:0};const goals=table('goals',[{ParticiantId:squad.id,TeamId:8466,StatValue:2}]);
 assert.equal(readLeagueStat(goals,'goals',squad.id,8466),2);
 assert.equal(readLeagueStat(table('goal_assist',[{ParticiantId:squad.id,TeamId:8466,StatValue:1}]),'goal_assist',squad.id,8466),1);
});
test('same player at another club, ambiguous rows and missing ranking entries do not become zero',()=>{
 assert.equal(readLeagueStat(table('goals',[{ParticiantId:1,TeamId:2,StatValue:3}]),'goals',1,3),null);
 assert.equal(readLeagueStat(table('goals',[]),'goals',1,2),null);
 assert.equal(readLeagueStat(table('goals',[{ParticiantId:1,TeamId:2,StatValue:1},{ParticiantId:1,TeamId:2,StatValue:2}]),'goals',1,2),null);
 assert.equal(readLeagueStat(table('goals',[{ParticiantId:1,TeamId:2,StatValue:0}]),'goals',1,2),0);
 assert.equal(readLeagueStat(table('goals',[{ParticiantId:1,TeamId:2,StatValue:'2'}]),'goals',1,2),null);
});
test('minutes use explicit MatchesPlayed and MinutesPlayed rather than rating count',()=>{
 const d=table('mins_played',[{ParticiantId:1,TeamId:2,StatValue:675,MatchesPlayed:10,MinutesPlayed:675}]);
 assert.equal(readLeagueStat(d,'mins_played',1,2,'MatchesPlayed'),10);assert.equal(readLeagueStat(d,'mins_played',1,2,'MinutesPlayed'),675);
});
test('zero requires explicit player season evidence with matching identity, current club, league and season',()=>{
 const p={id:1,primaryTeam:{teamId:2},mainLeague:{leagueId:48,season:'2026/2027',stats:[{localizedTitleId:'goals',value:0},{localizedTitleId:'assists',value:1}]}},scope={playerId:1,clubId:2,leagueId:48,season:'2026/2027'};
 assert.equal(readPublishedZero(p,scope,'goals'),0);assert.equal(readPublishedZero(p,scope,'assists'),null);
 for(const change of [{playerId:3},{clubId:3},{leagueId:73},{season:'2025/2026'}])assert.equal(readPublishedZero(p,{...scope,...change},'goals'),null);
 assert.equal(readPublishedZero({...p,mainLeague:{...p.mainLeague,stats:[]}},scope,'goals'),null);
});
test('legacy FotMob squad totals cannot silently reappear as saved verified values',()=>{
 assert.equal(trustedSavedTotals({provider:'FotMob',goals:0}),false);
 assert.equal(trustedSavedTotals({provider:'FotMob',totals_method:'league-statistics-v2'}),true);
 assert.equal(trustedSavedTotals({provider:'Sofascore'}),true);
});
