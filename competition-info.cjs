// Use published tournament identity; never relabel cup results as league matches.
const {competition,registered}=require('./uefa-registration.cjs');
function competitionInfo(t,seed){
 const id=Number(t.parentLeagueId||t.leagueId),european=competition(id);
 if(european)return{id,name:european.name,type:'cup',international:true};
 const league=seed.leagues.find(l=>Number(l[1])===id);
 if(league)return{id,name:league[0],type:'league',international:false};
 const name=String(t.name||t.leagueName||'').trim();
 if(!Number.isInteger(id)||id<=0||!name||/friendl|test match/i.test(name))return null;
 const normalized=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if(!/\b(cup|copa|coppa|coupe|beker|taca|pokal|pokalen|puchar|kup|supercoppa|supercopa|supercoupe|supercup|superpokal)\b/i.test(normalized))return null;
 return{id,name,type:'cup',international:false};
}
function applicableAffiliation(info,p,a,seed,day){
 if(!info)return false;
 if(info.international)return registered(seed.competition_eligibility,p.player_id,a.club_id,info.name,day);
 return info.type==='cup'||a.league===info.name;
}
module.exports={competitionInfo,applicableAffiliation};
