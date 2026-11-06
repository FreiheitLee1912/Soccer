// Positive events are evidence; an absent event is never an inferred zero.
function matchEvidence(d) {
  const raw=d.content?.matchFacts?.events?.events||[];
  const events=[...new Map(raw.filter(e=>e.eventId).map(e=>[String(e.eventId),e])).values()];
  const maps={goals:new Map(),assists:new Map(),own_goals:new Map(),yellow_cards:new Map(),red_cards:new Map()};
  const add=(key,id,e)=>{id=Number(id);if(!(id>0))return;if(!maps[key].has(id))maps[key].set(id,[]);maps[key].get(id).push({event_id:e.eventId,minute:e.time,added_time:e.overloadTime||0})};
  const goals=events.filter(e=>e.type==='Goal'&&!e.isPenaltyShootoutEvent);
  let score=[0,0],complete=true;
  for(const e of goals){
    const next=e.newScore;
    if(!Array.isArray(next)||next.length!==2||!next.every(Number.isInteger)){complete=false;break}
    const delta=next.map((n,i)=>n-score[i]);
    if(!((delta[0]===1&&delta[1]===0)||(delta[0]===0&&delta[1]===1))){complete=false;break}
    score=next;
  }
  const teams=d.header?.teams||[];
  complete=complete&&teams.length===2&&score.every((n,i)=>n===teams[i].score);
  if(complete)for(const e of goals){
    const id=e.playerId||e.player?.id,own=e.ownGoal||e.shotmapEvent?.isOwnGoal;
    add(own?'own_goals':'goals',id,e);
    if(!own)add('assists',e.assistPlayerId,e);
  }
  for(const e of events.filter(e=>e.type==='Card')){
    const id=e.playerId||e.player?.id;
    if(e.card==='Yellow'||e.card==='YellowRed')add('yellow_cards',id,e);
    if(e.card==='Red'||e.card==='YellowRed')add('red_cards',id,e);
  }
  return {maps,complete,hasGoalEvents:goals.length>0};
}

function reconcilePlayer(values,person,evidence,url){
  const result={},issues=[],sources={};
  for(const key of ['goals','assists','own_goals','yellow_cards','red_cards']){
    const stat=values[key],events=person?evidence.maps[key].get(Number(person.id))||[]:[];
    result[key]=stat;
    if(events.length){
      sources[key]={source_url:url,events};
      // A complete positive timeline can recover lagging stats. A larger stat
      // count is not resolved with Math.max: it needs a source review.
      if(stat===null||stat<=events.length)result[key]=events.length;
      else {result[key]=null;issues.push({field:key,reason:'stat_event_conflict',stat_value:stat,event_value:events.length,source_url:url})}
    } else if(key==='goals'&&evidence.complete&&stat>0){
      result[key]=null;issues.push({field:key,reason:'stat_event_conflict',stat_value:stat,event_value:0,source_url:url});
    }
  }
  return {...result,event_evidence:sources,quality_issues:issues};
}
module.exports={matchEvidence,reconcilePlayer};
