const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const clubAliases={'St.Truiden':'Sint-Truidense VV','Genk':'KRC Genk'};
const clubKey=s=>normalize(String(clubAliases[s]||s||'').replace(/\b(FC|SC|SV|AFC|KRC)\b/gi,''));
function resolvePlayer(results,name,club){
 const candidates=results.filter(r=>r.type==='player'&&r.entity?.team?.sport?.slug==='football');
 const exact=candidates.filter(r=>r.entity.country?.alpha2==='JP'&&normalize(r.entity.name)===normalize(name));
 if(exact.length===1)return exact[0].entity;
 if(!club)return null;
 const parts=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().split(/\s+/).map(normalize);
 const verified=candidates.filter(r=>clubKey(r.entity.team.name)===clubKey(club)&&parts.every(p=>normalize(r.entity.name).includes(p)));
 return verified.length===1?verified[0].entity:null;
}
const aliases={
 'EFL Championship':['Championship'],
 'La Liga':['LaLiga'],'Belgian Pro League':['Pro League','Belgian Pro League','Jupiler Pro League'],
 'Primeira Liga':['Liga Portugal Betclic','Liga Portugal'],'Scottish Premiership':['Premiership'],
 'Austrian Bundesliga':['Bundesliga'],'Swiss Super League':['Super League'],
 'Danish Superliga':['Superliga'],'Segunda Division':['LaLiga 2'],
 'Challenger Pro League':['Challenger Pro League'],'Liga Portugal 2':['Liga Portugal 2','Liga Portugal 2 Meu Super'],
 'Croatian HNL':['HNL'],'Serbian SuperLiga':['Superliga'],'Romanian Liga I':['Superliga'],
 'Azerbaijan Premier League':['Premier League'],'Armenian Premier League':['Premier League'],
 'Latvian Virsliga':['Virsliga'],'Slovak Super Liga':['Superliga'],
 'Kazakhstan Premier League':['Premier League']
};
const countries={'Premier League':'England','EFL Championship':'England','La Liga':'Spain','Bundesliga':'Germany','2. Bundesliga':'Germany','Serie A':'Italy','Serie B':'Italy','Ligue 1':'France','Ligue 2':'France','Belgian Pro League':'Belgium','Challenger Pro League':'Belgium','Primeira Liga':'Portugal','Liga Portugal 2':'Portugal','Eredivisie':'Netherlands','Eerste Divisie':'Netherlands','Scottish Premiership':'Scotland','Austrian Bundesliga':'Austria','Swiss Super League':'Switzerland','Danish Superliga':'Denmark','Ekstraklasa':'Poland','Croatian HNL':'Croatia','Serbian SuperLiga':'Serbia','Romanian Liga I':'Romania','Azerbaijan Premier League':'Azerbaijan','Armenian Premier League':'Armenia','Latvian Virsliga':'Latvia','Slovak Super Liga':'Slovakia','Kazakhstan Premier League':'Kazakhstan'};
function selectSeason(tournaments,league,seasonYear){return tournaments.flatMap(t=>{
  const u=t.uniqueTournament;
  if(!u||normalize(u.category?.name)!==normalize(countries[league]))return [];
  if(![league,...aliases[league]||[]].some(n=>normalize(n)===normalize(u.name)))return [];
  return t.seasons.filter(s=>String(s.year)===seasonYear).map(s=>({tournament:u,season:s}));
})}
function readRating(stat){return typeof stat?.rating==='number'&&Number.isFinite(stat.rating)&&stat.rating>0&&stat.rating<=10&&Number.isInteger(stat.countRating)&&stat.countRating>0?{rating:stat.rating,rated_matches:stat.countRating}:null}
module.exports={normalize,resolvePlayer,selectSeason,readRating};
