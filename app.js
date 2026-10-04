/* JetX Multi-Platform Live Signal Engine — simulated WebSocket stream.
   Swap SIMULATION=false + real tokenized URL to go live against ssgportal .aspx feed. */

const PLATFORMS = {
  stake:    { name:'Stake',    slug:'stake',    mark:'S',  color:'#00e701', color2:'#00b3ff', url:'wss://live.ssgportal.com/jetx-feed/stake.aspx?token=DEMO_STAKE_TOKEN' },
  linebet:  { name:'Linebet',  slug:'linebet',  mark:'L',  color:'#22c55e', color2:'#f97316', url:'wss://live.ssgportal.com/jetx-feed/linebet.aspx?token=DEMO_LINEBET_TOKEN' },
  bangbet:  { name:'Bangbet',  slug:'bangbet',  mark:'B',  color:'#f97316', color2:'#facc15', url:'wss://live.ssgportal.com/jetx-feed/bangbet.aspx?token=DEMO_BANGBET_TOKEN' },
  xbet:     { name:'1xbet',    slug:'1xbet',    mark:'1X', color:'#2f7bff', color2:'#7dd3fc', url:'wss://live.ssgportal.com/jetx-feed/1xbet.aspx?token=DEMO_1XBET_TOKEN' },
  melbet:   { name:'Melbet',   slug:'melbet',   mark:'M',  color:'#facc15', color2:'#22c55e', url:'wss://live.ssgportal.com/jetx-feed/melbet.aspx?token=DEMO_MELBET_TOKEN' },
  b888:     { name:'888',      slug:'888',      mark:'888',color:'#ef4444', color2:'#f8fafc', url:'wss://live.ssgportal.com/jetx-feed/888.aspx?token=DEMO_888_TOKEN' },
  megapari: { name:'Megapari', slug:'megapari', mark:'MP', color:'#a78bfa', color2:'#facc15', url:'wss://live.ssgportal.com/jetx-feed/megapari.aspx?token=DEMO_MEGAPARI_TOKEN' },
};
let platform = 'stake';
let history = [];       // crashed multipliers
let roundId = 48213;
let phase = 'waiting';   // waiting | flying | crashed
let liveMult = 1.0, crashPoint = 2.0, flightT = 0, raf = null;
let tokenTTL = 120, tokenTimer = null, connected = false, simDrop = false;
let flightCurve = [];
let audioCtx = null;

const $ = id => document.getElementById(id);

/* ---------- platform UI ---------- */
function renderPlatforms(){
  const g = $('platform-grid'); g.innerHTML='';
  Object.entries(PLATFORMS).forEach(([key,p])=>{
    const d=document.createElement('div');
    d.className='plat'+(key===platform?' active':'');
    d.innerHTML=`<div class="lg" style="background:${p.color};color:#06121f">${p.mark}</div><div>${p.name}<small>${p.slug}.aspx feed</small></div>`;
    d.onclick=()=>switchPlatform(key);
    g.appendChild(d);
  });
}
function applyBranding(){
  const p=PLATFORMS[platform];
  document.body.dataset.platform=platform;
  document.documentElement.style.setProperty('--accent',p.color);
  document.documentElement.style.setProperty('--accent2',p.color2);
  $('brand-mark').textContent=p.mark;
  $('brand-mark').style.background=p.color;
  $('brand-sub').textContent=`Source: ${p.name} • ssgportal.com feed`;
  $('feed-url').textContent=p.url;
}
function switchPlatform(key){
  platform=key; applyBranding(); renderPlatforms();
  log(`Source switched → <b>${PLATFORMS[key].name}</b> · ${PLATFORMS[key].url}`,'');
  toast(`${PLATFORMS[key].name} feed selected`, false);
  resetToken(120); // new platform = new token session
}

/* ---------- simulated crash RNG (JetX-like) ---------- */
function drawCrash(){
  const u=Math.random();
  if(u<0.06) return +(1+Math.random()*0.15).toFixed(2); // instant bust
  const h=0.97/(1-u);                                   // pareto-ish
  const capped=Math.min(h, 60);
  return +Math.max(1.0,capped).toFixed(2);
}

/* ---------- SimulatedSocket (mirrors real WS API) ---------- */
function setConn(state, text){
  connected = state==='on';
  $('conn-dot').className='dot '+(state==='on'?'on':state==='off'?'off':'');
  $('conn-text').textContent=text;
}
function connect(url){
  setConn('wait','CONNECTING…');
  hideBanner();
  log(`Opening WebSocket → <b>${url}</b>`,'');
  // In production: const ws = new WebSocket(url); ws.onmessage = onProviderMsg; ...
  // Here we simulate handshake latency then start the round loop.
  setTimeout(()=>{
    if(simDrop){ onConnectionLost('handshake failed'); return; }
    const lat=18+Math.floor(Math.random()*40);
    $('latency').textContent=lat+' ms'; $('sig-latency').textContent=lat+' ms';
    setConn('on','● LIVE');
    startTokenCountdown();
    if(!raf) nextRound();
  }, 700);
}

/* ---------- token lifecycle ---------- */
function startTokenCountdown(){
  clearInterval(tokenTimer);
  tokenTimer=setInterval(()=>{
    tokenTTL--;
    if(tokenTTL<=0){ onTokenExpired(); return; }
    $('token-ttl').textContent=tokenTTL+'s';
    $('ttl-fill').style.width=(tokenTTL/120*100)+'%';
    $('ttl-fill').style.background = tokenTTL<20 ? 'var(--danger)' : 'var(--accent)';
  },1000);
}
function resetToken(s=120){ tokenTTL=s; $('token-ttl').textContent=s+'s'; clearInterval(tokenTimer); if(connected) startTokenCountdown(); hideBanner(); }
function onTokenExpired(){
  clearInterval(tokenTimer); setConn('off','TOKEN EXPIRED');
  showBanner('TOKEN EXPIRED — refresh the tokenized link or update session');
  log('<b>TOKEN EXPIRED.</b> Provider rejected heartbeat (401). Refresh required.','warn');
  toast('TOKEN EXPIRED — refresh session', true); beep(false);
}
function onConnectionLost(reason){
  setConn('off','CONNECTION LOST');
  showBanner('CONNECTION LOST — ' + reason + ' · reconnect or refresh link');
  log('<b>CONNECTION LOST:</b> '+reason,'warn');
  toast('CONNECTION LOST', true); beep(false);
}
function showBanner(t){ $('alert-banner-text').textContent=t; $('alert-banner').classList.remove('hidden'); }
function hideBanner(){ $('alert-banner').classList.add('hidden'); }

/* ---------- round engine: waiting → flying → crashed ---------- */
function nextRound(){
  if(!connected) { raf=setTimeout(nextRound,1500); return; }
  phase='waiting'; setPhase('waiting','WAITING');
  $('multiplier').classList.remove('crashed');
  let wait=1200+Math.random()*1800;
  log(`Round <b>#${roundId+1}</b> boarding…`,'');
  setTimeout(()=>{
    if(!connected){ raf=setTimeout(nextRound,1500); return; }
    roundId++; crashPoint=drawCrash(); flightT=0; flightCurve=[1];
    phase='flying'; setPhase('flying','FLYING ●');
    $('round-id').textContent='#'+roundId;
    const players=120+Math.floor(Math.random()*380), staked=(players*(4+Math.random()*30))|0;
    $('live-sub').textContent=`${players} players • $${staked.toLocaleString()} staked`;
    tickFlight();
  }, wait);
}
function tickFlight(){
  if(!connected) return;
  flightT+=0.12;
  // exponential JetX curve, crash exactly at crashPoint
  liveMult = Math.min(crashPoint, Math.exp(0.14*flightT));
  if(liveMult>=crashPoint){ endRound(); return; }
  $('multiplier').textContent=liveMult.toFixed(2)+'x';
  flightCurve.push(liveMult);
  drawChart(false);
  updateSignalLive();
  raf=setTimeout(tickFlight, 100); // 10 ticks/sec ≈ provider push rate
}
function endRound(){
  phase='crashed'; setPhase('crashed','CRASHED');
  liveMult=crashPoint;
  const m=$('multiplier'); m.textContent=crashPoint.toFixed(2)+'x'; m.classList.add('crashed');
  history.unshift(crashPoint); if(history.length>60) history.pop();
  drawChart(true); renderHistory(); renderStats();
  log(`Round <b>#${roundId}</b> crashed @ <b>${crashPoint.toFixed(2)}x</b>`,'crash');
  const sig=computeSignal();
  pushSignal(sig, true);
  setTimeout(nextRound, 1400);
}
function setPhase(cls,txt){ const p=$('phase'); p.className='phase '+cls; p.textContent=txt; }

/* ---------- signal engine ---------- */
function stats(){
  const h=history.slice(0,50); if(!h.length) return {avg:2,low:0,since:0,max:2};
  const avg=h.reduce((a,b)=>a+b,0)/h.length;
  const low=h.filter(x=>x<2).length/h.length;
  const max=Math.max(...h);
  let since=0; for(const x of history){ if(x>=10) break; since++; }
  let lowStreak=0; for(const x of history){ if(x<2) lowStreak++; else break; }
  let highStreak=0; for(const x of history){ if(x>=3) highStreak++; else break; }
  return {avg,low,max,since,lowStreak,highStreak};
}
function computeSignal(){
  const s=stats();
  // momentum in [-1,1]
  const momentum=Math.max(-1,Math.min(1,(s.avg-2.4)/2 + (s.lowStreak>0? -0.12*s.lowStreak:0.1) + (s.since>14?0.25:0)));
  let action='BUY / ENTER', conf=62, target=2.0, stake='1.0u', risk='MEDIUM', reason='';
  if(s.lowStreak>=4){ conf=74+Math.min(18,s.lowStreak*2); target=Math.max(1.9,Math.min(4,s.avg*1.25)); reason=`Mean-reversion: ${s.lowStreak}-round sub-2x streak, snap-back likely.`; }
  else if(s.since>14 && s.avg<2.6){ conf=68+(Math.min(15,s.since-14)); target=3.0+Math.random()*2; stake='0.6u'; risk='HIGH'; reason=`Overdue moon: ${s.since} rounds since 10x+. Small stake, big target.`; }
  else if(momentum>0.25){ conf=60+momentum*25; target=+(1.8+momentum*2.2).toFixed(2); reason=`Hot momentum (+${momentum.toFixed(2)}): avg ${s.avg.toFixed(2)}x over last 50.`; }
  else if(s.highStreak>=2||momentum<-0.2){ action='WAIT / SKIP'; conf=63+Math.abs(momentum)*20; target=1.5; stake='—'; risk='LOW'; reason=`Cooling: ${s.highStreak} hot rounds in a row. Protect bankroll, skip.`; }
  else { conf=55+Math.random()*10; target=+(1.8+Math.random()).toFixed(2); reason=`Neutral flow: avg ${s.avg.toFixed(2)}x. Standard entry.`; }
  return {action,conf:Math.round(Math.min(94,conf)),target:+target.toFixed(2),stake,risk,reason,momentum};
}
function updateSignalLive(){
  const sig=computeSignal();
  paintSignal(sig,false);
  const m=(sig.momentum+1)/2*100;
  $('gauge-needle').style.left=m+'%';
  $('gauge-fill').style.opacity=.9;
  $('momentum-val').textContent=(sig.momentum>=0?'+':'')+sig.momentum.toFixed(2);
}
function pushSignal(sig, announce){
  paintSignal(sig,true);
  if(!$('sound-toggle').checked) return;
  if(announce){
    log(`⚡ SIGNAL <b>${sig.action}</b> · conf ${sig.conf}% · target ${sig.target.toFixed(2)}x — ${sig.reason}`,'sig');
    toast(`${sig.action} · ${sig.conf}% → ${sig.target.toFixed(2)}x`, sig.action.startsWith('WAIT'));
    beep(sig.action.startsWith('BUY'));
  }
}
function paintSignal(sig,stamp){
  const el=$('signal-action');
  el.textContent=sig.action;
  el.className='signal-action '+(sig.action.startsWith('BUY')?'buy':'wait');
  $('confidence').textContent=sig.conf;
  $('conf-fill').style.width=sig.conf+'%';
  $('signal-reason').textContent=sig.reason;
  $('target-mult').textContent=sig.target.toFixed(2)+'x';
  $('target-stake').textContent=sig.stake;
  $('target-risk').textContent=sig.risk;
  if(stamp) $('sig-time').textContent=new Date().toLocaleTimeString();
}

/* ---------- rendering ---------- */
function renderHistory(){
  const w=$('history-strip'); w.innerHTML='';
  history.slice(0,24).forEach(x=>{
    const d=document.createElement('div');
    d.className='hist '+(x<2?'low':x<3?'mid':x<10?'high':'moon');
    d.textContent=x.toFixed(2)+'x'; w.appendChild(d);
  });
}
function renderStats(){
  const s=stats();
  $('st-avg').textContent=s.avg.toFixed(2)+'x';
  $('st-max').textContent=s.max.toFixed(2)+'x';
  $('st-low').textContent=Math.round(s.low*100)+'%';
  $('st-since').textContent=s.since;
}
function log(html,cls){
  const d=document.createElement('div'); d.className='ev '+cls;
  d.innerHTML=`<span style="color:var(--mut)">${new Date().toLocaleTimeString()}</span> ${html}`;
  const box=$('event-log'); box.prepend(d);
  while(box.children.length>60) box.lastChild.remove();
}
function toast(msg,isSell){
  const t=document.createElement('div'); t.className='toast'+(isSell?' sell':''); t.textContent=(isSell?'🔴 ':'🟢 ')+msg;
  $('toast-wrap').appendChild(t); setTimeout(()=>t.remove(),4200);
}
function beep(up){
  try{
    if(!$('sound-toggle').checked) return;
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value=up?880:220; g.gain.value=0.06;
    o.start(); o.stop(audioCtx.currentTime+0.18);
  }catch(e){}
}
function drawChart(crashed){
  const c=$('flight-chart'), ctx=c.getContext('2d');
  const W=c.width=c.offsetWidth*2, H=c.height=440;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='rgba(255,255,255,.08)'; ctx.lineWidth=1;
  for(let i=1;i<5;i++){ ctx.beginPath(); ctx.moveTo(0,H*i/5); ctx.lineTo(W,H*i/5); ctx.stroke(); }
  const data=flightCurve.slice(-120); if(data.length<2) return;
  const max=Math.max(...data,2)*1.15;
  const X=i=>i/(120)*W, Y=v=>H-(v/max)*H*0.92-10;
  const grad=ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,PLATFORMS[platform].color2); grad.addColorStop(1,PLATFORMS[platform].color);
  ctx.beginPath(); data.forEach((v,i)=> i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)));
  ctx.strokeStyle=crashed?'#ff3b5c':grad; ctx.lineWidth=6; ctx.lineJoin='round'; ctx.stroke();
  ctx.lineTo(X(data.length-1),H); ctx.lineTo(0,H); ctx.closePath();
  ctx.fillStyle=crashed?'rgba(255,59,92,.12)':'rgba(0,231,1,.08)'; ctx.fill();
}

/* ---------- seed + wire up ---------- */
for(let i=0;i<28;i++) history.push(drawCrash());
renderPlatforms(); applyBranding(); renderHistory(); renderStats();
resetToken(120);
$('btn-connect').onclick=()=>{
  const custom=$('token-input').value.trim();
  const url=custom||PLATFORMS[platform].url;
  if(custom) PLATFORMS[platform].url=custom;
  $('feed-url').textContent=url; simDrop=false; resetToken(120); connect(url);
};
$('banner-action').onclick=()=>{ resetToken(120); simDrop=false; connect(PLATFORMS[platform].url); toast('Session refreshed — reconnecting',false); };
$('btn-refresh-token').onclick=()=>{ resetToken(120); log('Token refreshed manually. TTL reset to 120s.','sig'); toast('Token refreshed (TTL 120s)',false); };
$('btn-drop').onclick=()=>{ onConnectionLost('simulated network drop'); };
connect(PLATFORMS[platform].url);
