/* Shared transfer-board renderer for both country pages.
   Reads window.TRANSFER_DATA. Two schemas:
   - England (lang en): rows carry fee / marketValue (Transfermarkt).
   - Japan   (lang ja): rows carry transferType / date (official J.League),
                        marketValue optionally merged from Transfermarkt.        */
const D = window.TRANSFER_DATA;
const T = D.transfers, CUR = D.currency || '€';
const JP = D.country === 'Japan';
const CN = D.country === 'China';
const LOCAL = JP || CN;
const MULTI = (D.divisions || []).length > 1;

const L = JP ? {
  IN:'IN', OUT:'OUT', player:'Player', age:'Age', value:'Value',
  from:'From', to:'To', fee:'Fee', date:'日付',
  netSpend:'純支出', netProfit:'純収入', none:'該当する移籍がありません。',
  source:'出典', updated:'更新',
  s1:'移籍・加入', s2:'完全移籍', s3:'レンタル', s4:'最高市場価値',
  foot:'ポジション: <b style="color:var(--gk)">GK</b> · <b style="color:var(--def)">DF</b> · '+
    '<b style="color:var(--mid)">MF</b> · <b style="color:var(--fwd)">FW</b>。'+
    '移籍情報は <a href="https://www.jleague.jp/special/transfer/" target="_blank" rel="noopener">J.LEAGUE 公式</a>。'+
    '市場価値・移籍金は <a href="https://www.transfermarkt.com/j1-league/transfers/wettbewerb/JAP1" target="_blank" rel="noopener">Transfermarkt</a> の公開値を照合。'+
    '「非公開」は金額未公表で、推定額ではありません。'
} : CN ? {
  IN:'转入', OUT:'转出', player:'球员', age:'年龄', value:'身价',
  from:'来自', to:'去向', fee:'转会费', date:'日期',
  netSpend:'净支出', netProfit:'净收入', none:'没有符合筛选条件的转会。',
  source:'来源', updated:'更新', s1:'转会加盟', s2:'永久转会', s3:'租借', s4:'最高身价',
  foot:'位置：<b style="color:var(--gk)">门将</b> · <b style="color:var(--def)">后卫</b> · '+
    '<b style="color:var(--mid)">中场</b> · <b style="color:var(--fwd)">前锋</b>。'+
    '身价与转会费以 <a href="https://www.transfermarkt.com/chinese-super-league/transfers/wettbewerb/CSL" target="_blank" rel="noopener">Transfermarkt</a> 公开数据为准；未披露金额显示为“未公开”。'
} : {
  IN:'IN', OUT:'OUT', player:'Player', age:'Age', value:'Value',
  from:'From', to:'To', fee:'Fee', date:'Date',
  netSpend:'Net spend', netProfit:'Net profit', none:'No transfers match your filters.',
  source:'Source', updated:'Updated',
  s1:'Total spend', s2:'Signings', s3:'Loans', s4:'Record signing',
  foot:'Positions: <b style="color:var(--gk)">GK</b> · <b style="color:var(--def)">DEF</b> · '+
    '<b style="color:var(--mid)">MID</b> · <b style="color:var(--fwd)">FWD</b>. '+
    'Fees &amp; market values are Transfermarkt estimates (EUR). '+
    '"Loan return" = player back from a loan spell. Typeface: official Premier League font.'
};

const DOT = { "Arsenal FC":"#EF0107","Aston Villa":"#95BFE5","AFC Bournemouth":"#DA291C",
 "Brentford FC":"#e30613","Brighton & Hove Albion":"#0057B8","Chelsea FC":"#034694",
 "Coventry City":"#6CABDD","Crystal Palace":"#1B458F","Everton FC":"#003399",
 "Fulham FC":"#cad4dc","Hull City":"#f18a01","Ipswich Town":"#3a64a3",
 "Leeds United":"#FFCD00","Liverpool FC":"#C8102E","Manchester City":"#6CABDD",
 "Manchester United":"#DA291C","Newcastle United":"#ffffff","Nottingham Forest":"#DD0000",
 "Sunderland AFC":"#eb172b","Tottenham Hotspur":"#132257" };
const LEAGUE_COLOR = { J1:"#e4002b", J2:"#0a8a3f", J3:"#1f6fb2", PL:"#37003c",
  "Premier League":"#37003c", "Championship":"#00158a",
  "League One":"#ff1b48", "League Two":"#73859f",
  "中超":"#de2910", "中甲":"#d69d00", "中乙":"#2672c9" };
const dotFor = c => DOT[c.name] || LEAGUE_COLOR[c.league] || '#888';

const POSG = { GK:'gk', DF:'def', MF:'mid', FW:'fwd',
 CB:'def',RB:'def',LB:'def',RWB:'def',LWB:'def',SW:'def',
 DM:'mid',CM:'mid',AM:'mid',LM:'mid',RM:'mid',
 LW:'fwd',RW:'fwd',CF:'fwd',SS:'fwd',ST:'fwd' };
const posGroup = p => POSG[(p||'').toUpperCase().split(' ')[0]] || 'na';

const esc = s => (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function hi(name,q){ const e=esc(name); if(!q) return e;
  const i=e.toLowerCase().indexOf(q.toLowerCase()); if(i<0) return e;
  return e.slice(0,i)+'<mark>'+e.slice(i,i+q.length)+'</mark>'+e.slice(i+q.length); }

// money in € millions -> "€40m" / "€1.5m" / "€200k" (sub-million shown in k)
function money(m){
  if(m==null) return '—';
  if(m===0) return CUR+'0';
  if(m<1) return CUR+Math.round(m*1000)+'k';
  return CUR+m+'m';
}

// Fee cell — actual transfer fee (Transfermarkt). Japan rows without a TM
// match have no known fee, so they show "—" (never the Japanese category).
function feeCell(t){
  if(LOCAL && !t.matched) return `<td class="fee fee-q">—</td>`;
  // The official source is authoritative for a loan return. TM may describe
  // the paired transaction simply as a loan, which would make a muted return
  // look like an ordinary active loan.
  const type = (LOCAL && t.type==='loan-return') ? 'loan-return' : (t.ftype || t.type);
  const cls={transfer:'fee-paid',free:'fee-free',loan:'fee-loan','loan-return':'fee-ret',promotion:'fee-promo',other:'fee-q'}[type]||'fee-q';
  let label=t.fee;
  if(type==='transfer'&&t.feeValue!=null) label=money(t.feeValue);
  else if(type==='loan-return') label=JP?'レンタル終了':CN?'租借回归':'Loan return';
  else if(type==='loan'&&(t.fee||'').startsWith('Loan')) {
    label=t.fee.replace('€',CUR);
    if(JP) label=label.replace(/^Loan/, 'レンタル');
    if(CN) label=label.replace(/^Loan/, '租借');
  }
  else if(type==='loan') label=JP?'レンタル':CN?'租借':'Loan';
  else if(type==='free') label=JP?'フリー':CN?'自由转会':'Free';
  else if(type==='promotion') label='Promotion';
  else if(type==='other') label=JP?'非公開':CN?'未公开':'Undisclosed';
  return `<td class="fee ${cls}">${esc(label)}</td>`;
}
const mvCell = t => `<td class="mv">${money(t.marketValueNum)}</td>`;
const posCell = t => `<td class="pos"><span class="pill ${posGroup(t.pos)}" title="${esc(t.position||'')}">${t.pos||'?'}</span></td>`;
const taiwanNat = n => /taiwan|chinese taipei|台湾|臺灣|中华台北|中華臺北/i.test(n||'');
const FLAG_EMOJI={Japan:'🇯🇵',Brazil:'🇧🇷','Korea, South':'🇰🇷','South Korea':'🇰🇷',
  China:'🇨🇳',Australia:'🇦🇺',Sweden:'🇸🇪',Bulgaria:'🇧🇬',Panama:'🇵🇦',Togo:'🇹🇬',
  France:'🇫🇷',Scotland:'🏴󠁧󠁢󠁳󠁣󠁴󠁿',England:'🏴󠁧󠁢󠁥󠁮󠁧󠁿',Philippines:'🇵🇭'};
const nationMark = t => taiwanNat(t.nationality)
  ? `<span class="nation-emoji" title="${esc(t.nationality||'Taiwan')}">🇹🇼</span>`
  : (t.nationalityFlag ? `<img class="nation" src="${esc(t.nationalityFlag)}" alt="" title="${esc(t.nationality||'')}" loading="eager" referrerpolicy="no-referrer">`
    : (FLAG_EMOJI[t.nationality] ? `<span class="nation-emoji" title="${esc(t.nationality)}">${FLAG_EMOJI[t.nationality]}</span>` : ''));
const nameCell = (t,q) => `<td class="name"><span class="name-line">${hi(t.player,q)}${nationMark(t)}</span>${
  t.roman ? `<span class="rom">${esc(t.roman)}</span>` :
  (CN && t.date ? `<span class="rom">${esc(t.date)}</span>` : '')}</td>`;

// ---- header stats ----
(function(){
  const sub=document.getElementById('sub');
  sub.innerHTML=`${L.source}: ${esc(D.source)} · ${L.updated} ${esc(D.generatedAt)}`;
  let cards;
  if(LOCAL){
    const mv=T.filter(t=>t.marketValueNum!=null).sort((a,b)=>b.marketValueNum-a.marketValueNum)[0];
    cards=[
      [L.s1, T.filter(t=>t.type==='transfer'&&t.direction==='in').length],
      [L.s3, T.filter(t=>t.type==='loan').length],
      [CN?'俱乐部':'クラブ', D.clubs.length],
      [L.s4, mv?`${CUR}${mv.marketValueNum}m · ${esc(mv.player)}`:'—'],
    ];
  } else {
    const paid=T.filter(t=>t.type==='transfer'&&t.direction==='in'&&t.feeValue);
    const spend=paid.reduce((a,b)=>a+b.feeValue,0);
    const big=[...paid].sort((a,b)=>b.feeValue-a.feeValue)[0];
    cards=[
      [L.s1, CUR+spend.toFixed(0)+'m'],
      [L.s2, T.filter(t=>t.type==='transfer'&&t.direction==='in').length],
      [L.s3, T.filter(t=>t.type==='loan').length],
      [L.s4, big?`${CUR}${big.feeValue}m · ${esc(big.player)}`:'—'],
    ];
  }
  document.getElementById('stats').innerHTML=
    cards.map(([k,v])=>`<div class="stat">${k}<b>${v}</b></div>`).join('');
  // club dropdown (grouped by division when multi)
  const sel=document.getElementById('clubSel');
  if(MULTI){
    D.divisions.forEach(lg=>{
      const og=document.createElement('optgroup'); og.label=lg;
      D.clubs.filter(c=>c.league===lg).forEach(c=>og.insertAdjacentHTML('beforeend',`<option>${esc(c.name)}</option>`));
      sel.appendChild(og);
    });
  } else {
    D.clubs.forEach(c=>sel.insertAdjacentHTML('beforeend',`<option>${esc(c.name)}</option>`));
  }
})();

let TYPE='all';
const el=id=>document.getElementById(id);
const S=()=>({q:el('q').value.trim(), club:el('clubSel').value,
  pos:el('posSel').value, league:el('leagueSel')?el('leagueSel').value:'', type:TYPE});

function pass(t,s){
  if(s.q && !`${t.player} ${t.roman||''}`.toLowerCase().includes(s.q.toLowerCase())) return false;
  if(s.pos && posGroup(t.pos)!==s.pos) return false;
  if(s.type==='deal' && t.type!=='transfer' && t.type!=='free') return false;
  if(s.type==='loan' && t.type!=='loan' && t.type!=='loan-return') return false;
  return true;
}
const rank=(a,b)=>(b.feeValue||0)-(a.feeValue||0)
  ||(b.marketValueNum||0)-(a.marketValueNum||0)
  ||String(b.date||'').localeCompare(String(a.date||''));
const playerKey=t=>String(t.playerId||t.player||'').trim().toLowerCase();

function sideHTML(rows,side,s,loanedOut){
  const other = side==='in' ? L.from : L.to;
  const head=`<th></th><th>${L.player}</th><th class="r">${L.age}</th>`+
    `<th class="r mvh">${L.value}</th><th>${other}</th><th class="r">${L.fee}</th>`;
  const cells=t=>posCell(t)+nameCell(t,s.q)+`<td class="age">${t.age||''}</td>`+
    mvCell(t)+`<td class="club">${esc(t.otherClub)}</td>`+feeCell(t);
  // OUT: permanent/free/contract exits and loan returns are muted; a player
  // merely sent out on loan stays at normal brightness.
  const dim=t=>(side==='out'&&t.type!=='loan')
    ||(side==='in'&&loanedOut.has(playerKey(t)));
  const body=rows.map(t=>`<tr class="${dim(t)?'row-muted':''}">${cells(t)}</tr>`).join('');
  return `<div class="side ${side}"><h3>${side==='in'?L.IN:L.OUT} <span class="c">${rows.length}</span></h3>${
    rows.length?`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
              :'<div class="empty">—</div>'}</div>`;
}

function render(){
  const s=S(), grid=el('grid'); grid.innerHTML=''; let shown=0;
  grid.classList.toggle('single-club', !!s.club);
  D.clubs.forEach(c=>{
    if(s.club && s.club!==c.name) return;
    if(s.league && s.league!==c.league) return;
    const teamIns =T.filter(t=>t.club===c.name&&t.direction==='in');
    const teamOuts=T.filter(t=>t.club===c.name&&t.direction==='out');
    // Only OUT loan means this club is the parent club sending the player away.
    // Loan-return and permanent-sale rows can be bookkeeping around a buyout,
    // so they must not mute the matching IN row.
    const loanedOut=new Set(teamOuts.filter(t=>t.type==='loan').map(playerKey));
    const ins =teamIns.filter(t=>pass(t,s)).sort(rank);
    const outs=teamOuts.filter(t=>pass(t,s)).sort(rank);
    if(!ins.length&&!outs.length) return; shown++;
    let netBadge='';
    if(!LOCAL){
      const spent=ins.filter(t=>t.type==='transfer').reduce((a,b)=>a+(b.feeValue||0),0);
      const sold =outs.filter(t=>t.type==='transfer').reduce((a,b)=>a+(b.feeValue||0),0);
      const net=spent-sold;
      netBadge=`<span class="badge-net ${net>=0?'net-pos':'net-neg'}">`+
        `${net>=0?L.netSpend:L.netProfit} ${CUR}${Math.abs(net).toFixed(1)}m</span>`;
    } else {
      netBadge=`<span class="badge-net net-cnt">${L.IN} ${ins.length} · ${L.OUT} ${outs.length}</span>`;
    }
    const lg = MULTI ? `<span class="lg" style="--dot:${dotFor(c)}">${c.league}</span>` : '';
    const crest = c.logo ? `<img class="crest" src="${esc(c.logo)}" alt="" loading="eager" referrerpolicy="no-referrer">` : '';
    grid.insertAdjacentHTML('beforeend',
     `<div class="team"><h2 style="--dot:${dotFor(c)}">${lg}${crest}${esc(c.name)}${netBadge}</h2>`+
     sideHTML(ins,'in',s,loanedOut)+sideHTML(outs,'out',s,loanedOut)+`</div>`);
  });
  el('none').style.display=shown?'none':'block';
  grid.style.display=shown?'grid':'none';
}

['q','clubSel','posSel','leagueSel'].forEach(id=>{const e=el(id); if(!e) return;
  e.addEventListener(e.type==='search'?'input':'change',render);});
document.querySelectorAll('#typeSeg button').forEach(b=>b.onclick=()=>{
  TYPE=b.dataset.t;
  document.querySelectorAll('#typeSeg button').forEach(x=>x.classList.toggle('on',x===b));
  render();});
document.getElementById('foot').innerHTML=L.foot;

// ---- light / dark theme toggle (persisted; shared across pages) ----
const themeBtn=document.getElementById('themeBtn');
function applyTheme(){
  const t=localStorage.getItem('pl-theme');
  if(t) document.documentElement.setAttribute('data-theme',t);
  else document.documentElement.removeAttribute('data-theme');
  const dark = t ? t==='dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  themeBtn.textContent = dark ? (JP?'☀ ライト':CN?'☀ 浅色':'☀ Light') : (JP?'☾ ダーク':CN?'☾ 深色':'☾ Dark');
}
themeBtn.onclick=()=>{
  const cur=document.documentElement.getAttribute('data-theme')
    || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  localStorage.setItem('pl-theme', cur==='dark'?'light':'dark');
  applyTheme();
};
applyTheme();
render();
