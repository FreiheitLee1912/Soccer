const {normalize}=require('./sofascore-season.cjs');
function readMarketValue(player,expected,day){
 if(String(player?.id)!==String(expected.id)||normalize(player.name)!==normalize(expected.name)||!expected.clubs.some(id=>String(id)===String(player.primaryTeam?.teamId))||!(player.playerInformation||[]).some(r=>r.countryCode==='JPN'))throw Error('Market value player identity/current club not confirmed');
 const values=(player.marketValues?.values||[]).filter(r=>typeof r.value==='number'&&Number.isFinite(r.value)&&r.value>0&&r.currency==='EUR'&&Number.isFinite(Date.parse(r.date))&&r.date.slice(0,10)<=day).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const r=values[0];return r?{value:r.value,currency:r.currency,valuation_date:r.date.slice(0,10),valuation_provider:r.source==='scisports'?'SciSports':r.source||'FotMob',club_id:player.primaryTeam.teamId}:null;
}
module.exports={readMarketValue};
