const valid=n=>typeof n==='number'&&Number.isInteger(n)&&n>=0;
function readLeagueStat(data,stat,playerId,clubId,field='StatValue'){
 const rows=(data?.TopLists||[]).filter(l=>l.StatName===stat).flatMap(l=>l.StatList||[]).filter(r=>String(r.ParticiantId)===String(playerId)&&String(r.TeamId)===String(clubId));
 return rows.length===1&&valid(rows[0][field])?rows[0][field]:null;
}
// Scorer/assist leaderboards omit zero contributors. Absence is not evidence of zero.
function readPublishedZero(player,scope,key){
 if(String(player?.id)!==String(scope.playerId)||String(player.primaryTeam?.teamId)!==String(scope.clubId)||String(player.mainLeague?.leagueId)!==String(scope.leagueId)||player.mainLeague?.season!==scope.season)return null;
 const rows=(player.mainLeague.stats||[]).filter(s=>s.localizedTitleId===key);
 return rows.length===1&&rows[0].value===0?0:null;
}
function trustedSavedTotals(row){return row?.provider==='Sofascore'||row?.provider==='FotMob'&&row.totals_method==='league-statistics-v2'}
module.exports={readLeagueStat,readPublishedZero,trustedSavedTotals};
