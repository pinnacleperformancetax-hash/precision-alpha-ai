const qs=(s)=>document.querySelector(s);
const qsa=(s)=>Array.from(document.querySelectorAll(s));

// ── SAFETY RULES ──────────────────────────────────────────────────────────────
const RULES = {
  maxDailyLoss:50, maxTrades:3, maxPositionSize:200,
  maxLossPerTrade:15, takeProfitTarget:30,
  minConfidence:75, maxVolatility:70, minSyncScore:75,
  tradeStartHour:10, tradeEndHour:15, tradeEndMinute:30
};

// ── ALPACA ────────────────────────────────────────────────────────────────────
const ALPACA_KEY    = 'PKOKJQWTT4NSZ64VGBN7GLEP6T';
const ALPACA_SECRET = 'FonC1S7yhNZEx1p9Auscbs5s6qcTt4U4isjnwearYkad';
const BASE_URL      = 'https://paper-api.alpaca.markets/v2';
const DATA_URL      = 'https://data.alpaca.markets/v2';

let state = {
  killed: false,
  weeklyTrades: JSON.parse(localStorage.getItem('pa_weekly_trades')||'[]'),
  todayPL: parseFloat(localStorage.getItem('pa_today_pl')||'0'),
};
const today = new Date().toDateString();
if(localStorage.getItem('pa_last_date')!==today){state.todayPL=0;localStorage.setItem('pa_today_pl','0');localStorage.setItem('pa_last_date',today);}
function getWeekKey(){const d=new Date(),day=d.getDay(),diff=d.getDate()-day+(day===0?-6:1);return new Date(d.setDate(diff)).toDateString();}
if(localStorage.getItem('pa_week_key')!==getWeekKey()){state.weeklyTrades=[];localStorage.setItem('pa_weekly_trades','[]');localStorage.setItem('pa_week_key',getWeekKey());}

async function alpaca(path,method='GET',body=null){
  const opts={method,headers:{'APCA-API-KEY-ID':ALPACA_KEY,'APCA-API-SECRET-KEY':ALPACA_SECRET,'Content-Type':'application/json'}};
  if(body)opts.body=JSON.stringify(body);
  const res=await fetch(BASE_URL+path,opts);
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.message||`HTTP ${res.status}`);}
  return res.json();
}
async function getLatestTrade(symbol){
  const res=await fetch(`${DATA_URL}/stocks/${symbol}/trades/latest`,{headers:{'APCA-API-KEY-ID':ALPACA_KEY,'APCA-API-SECRET-KEY':ALPACA_SECRET}});
  if(!res.ok)throw new Error('Symbol not found');
  return res.json();
}

function fmtMoney(v){const n=parseFloat(v)||0;return(n<0?'-$':'$')+Math.abs(n).toFixed(2);}
function isMarketHours(){const now=new Date(),est=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'})),h=est.getHours(),m=est.getMinutes();return(h>RULES.tradeStartHour||(h===RULES.tradeStartHour))&&(h<RULES.tradeEndHour||(h===RULES.tradeEndHour&&m<=RULES.tradeEndMinute));}
function toast(msg,type='success'){
  let el=qs('#paToast');
  if(!el){el=document.createElement('div');el.id='paToast';el.style.cssText='position:fixed;bottom:24px;right:24px;padding:14px 20px;border-radius:14px;font-weight:800;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9999;max-width:340px;background:#0d1117;border:1px solid #202838;color:#f7f7f7';document.body.appendChild(el);}
  el.textContent=msg;
  el.style.opacity='1';
  if(type==='success')el.style.borderColor='rgba(103,255,116,.4)';
  else if(type==='error')el.style.borderColor='rgba(255,79,79,.4)';
  else el.style.borderColor='rgba(255,214,0,.4)';
  setTimeout(()=>el.style.opacity='0',3500);
}

function checkSafetyGate(confidence,volatility,syncScore){
  const issues=[];const warns=[];
  if(state.killed) issues.push('⛔ Kill switch is active');
  if(state.todayPL<=-RULES.maxDailyLoss) issues.push(`Daily loss limit hit (${fmtMoney(state.todayPL)})`);
  if(state.weeklyTrades.length>=RULES.maxTrades) issues.push(`Weekly trade limit reached (${state.weeklyTrades.length}/${RULES.maxTrades})`);
  if(!isMarketHours()) issues.push('Outside trading hours (10am–3:30pm EST)');
  if(confidence<RULES.minConfidence) issues.push(`Confidence too low (${confidence} < ${RULES.minConfidence})`);
  if(volatility>RULES.maxVolatility) issues.push(`Volatility too high (${volatility} > ${RULES.maxVolatility})`);
  if(syncScore<RULES.minSyncScore) issues.push(`Sync score too low (${syncScore} < ${RULES.minSyncScore})`);
  if(confidence<80&&confidence>=RULES.minConfidence) warns.push(`Confidence borderline (${confidence})`);
  if(volatility>60&&volatility<=RULES.maxVolatility) warns.push(`Volatility elevated (${volatility})`);
  return{ok:issues.length===0,issues,warns};
}

async function analyzeTradeWithAI(symbol,side,qty,price,confidence,volatility,syncScore,style){
  const prompt=`You are Precision Alpha AI, an expert trading analyst. Analyze this paper trade and give a clear verdict.

TRADE: ${side.toUpperCase()} ${qty} shares of ${symbol} at $${price.toFixed(2)} (total $${(price*qty).toFixed(2)})
STYLE: ${style}
SIGNALS: X24 Confidence ${confidence}/100 · X25 Volatility ${volatility}/100 · X26 Sync ${syncScore}/100
RULES: Max loss $${RULES.maxLossPerTrade}/trade · Target profit $${RULES.takeProfitTarget}/trade

Provide:
1. VERDICT: exactly "✅ GOOD TRADE" or "⚠️ RISKY TRADE" or "❌ BAD TRADE"
2. SCORE: 0-100
3. REASON: 2-3 simple sentences anyone can understand. No jargon.
4. STOP LOSS: specific price to exit if wrong
5. TAKE PROFIT: specific price to exit when profitable
6. TIP: one actionable tip

Be direct and honest.`;
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:500,messages:[{role:'user',content:prompt}]})});
  const data=await response.json();
  return data.content[0].text;
}

// ── ACCOUNT DASHBOARD ─────────────────────────────────────────────────────────
async function loadAccountData(){
  try{
    const acct=await alpaca('/account');
    const equity=parseFloat(acct.equity);
    const pl=equity-parseFloat(acct.last_equity);
    state.todayPL=pl;localStorage.setItem('pa_today_pl',pl.toString());
    // Update stat cards if they exist
    const balEl=qs('#acctBalance');if(balEl)balEl.textContent=fmtMoney(equity);
    const plEl=qs('#acctPL');if(plEl){plEl.textContent=fmtMoney(pl);plEl.style.color=pl>=0?'var(--green)':'#ff4f4f';}
    const trEl=qs('#acctTrades');if(trEl)trEl.textContent=`${state.weeklyTrades.length} / ${RULES.maxTrades}`;
  }catch(e){console.error('Alpaca load failed:',e);}
}

// ── PLACE TRADE VIEW ──────────────────────────────────────────────────────────
function buildTradeView(){
  const existing=qs('#trade');if(existing)return;
  // Add nav button
  const nav=qs('.nav[data-view="replay"]');
  if(nav){
    const btn=document.createElement('button');
    btn.className='nav';btn.dataset.view='trade';btn.textContent='Place Trade';
    nav.parentNode.insertBefore(btn,nav);
    btn.addEventListener('click',()=>showView('trade'));
  }
  // Add kill switch
  const sidebar=qs('.sidebar');
  if(sidebar&&!qs('#killBtn')){
    const kw=document.createElement('div');kw.style.cssText='margin-top:16px;padding-top:16px;border-top:1px solid #202838';
    kw.innerHTML='<button id="killBtn" style="width:100%;padding:12px 14px;background:rgba(255,79,79,.1);color:#ff4f4f;border:1px solid rgba(255,79,79,.3);border-radius:13px;font-weight:900;cursor:pointer;font-size:13px">⛔ KILL SWITCH</button>';
    sidebar.appendChild(kw);
    qs('#killBtn').addEventListener('click',activateKill);
  }
  // Build trade section
  const main=qs('.main');
  const section=document.createElement('section');
  section.id='trade';section.className='view';
  section.innerHTML=`
<h2>Place Paper Trade</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
  <div class="panel">
    <label>Stock Symbol</label>
    <input type="text" id="tradeSymbol" placeholder="e.g. AAPL, TSLA, SPY"/>
    <label>Action</label>
    <select id="tradeAction"><option value="buy">BUY</option><option value="sell">SELL</option></select>
    <label>Quantity (shares)</label>
    <input type="number" id="tradeQty" value="1" min="1"/>
    <label>Order Type</label>
    <select id="tradeOrderType"><option value="market">Market Order</option><option value="limit">Limit Order</option></select>
    <div id="limitPriceGroup" style="display:none"><label>Limit Price ($)</label><input type="number" id="tradeLimitPrice" step="0.01" placeholder="0.00"/></div>
    <label>X24 Confidence &nbsp;<strong id="tradeConfidenceVal" style="color:var(--gold)">75</strong></label>
    <input type="range" min="0" max="100" value="75" id="tradeConfidence"/>
    <label>X25 Volatility &nbsp;<strong id="tradeVolatilityVal" style="color:var(--gold)">50</strong></label>
    <input type="range" min="0" max="100" value="50" id="tradeVolatility"/>
    <label>X26 Sync Score &nbsp;<strong id="tradeSyncVal" style="color:var(--gold)">80</strong></label>
    <input type="range" min="0" max="100" value="80" id="tradeSyncScore"/>
    <label>🧠 AI Trading Style</label>
    <select id="tradeStyle">
      <option value="Momentum">🏃 Momentum — Ride strong moving stocks</option>
      <option value="Mean Reversion">🔄 Mean Reversion — Buy dips, sell spikes</option>
      <option value="Breakout">💥 Breakout — Enter on key level breaks</option>
      <option value="Conservative">🐢 Conservative — Only highest confidence</option>
      <option value="Aggressive">⚡ Aggressive — Higher risk, higher reward</option>
    </select>
    <div id="tradeGateResult" style="display:none;margin:12px 0;padding:14px;border-radius:14px;font-weight:800;font-size:14px;line-height:1.6"></div>
    <button class="gold" id="checkGateBtn" style="width:100%">🔍 Check Gate + AI Analysis</button>
    <button id="submitTradeBtn" style="display:none;width:100%;margin-top:8px;padding:13px;background:linear-gradient(180deg,#7fff8a,#3dd44a);border:0;border-radius:13px;font-weight:900;cursor:pointer;font-size:14px;color:#0a1a0a">⚡ Submit Paper Trade</button>
  </div>
  <div>
    <div class="panel"><strong style="display:block;margin-bottom:10px;color:var(--muted);font-size:13px">📊 LIVE QUOTE</strong><div id="quoteBox"><p style="color:var(--muted);font-size:13px">Enter a symbol and check the gate.</p></div></div>
    <div class="panel"><strong style="display:block;margin-bottom:10px;color:var(--muted);font-size:13px">⚠️ RISK CALCULATOR</strong><div id="riskBox"><p style="color:var(--muted);font-size:13px">Set quantity to calculate risk.</p></div></div>
    <div id="aiAnalysisBox" style="display:none"></div>
  </div>
</div>`;
  // Insert before first section
  const firstSection=qs('.main section');
  if(firstSection)main.insertBefore(section,firstSection);else main.appendChild(section);

  // Events
  qs('#tradeSymbol').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase());
  qs('#tradeOrderType').addEventListener('change',()=>{qs('#limitPriceGroup').style.display=qs('#tradeOrderType').value==='limit'?'block':'none';});
  qs('#tradeConfidence').addEventListener('input',e=>qs('#tradeConfidenceVal').textContent=e.target.value);
  qs('#tradeVolatility').addEventListener('input',e=>qs('#tradeVolatilityVal').textContent=e.target.value);
  qs('#tradeSyncScore').addEventListener('input',e=>qs('#tradeSyncVal').textContent=e.target.value);
  qs('#checkGateBtn').addEventListener('click',checkGate);
  qs('#submitTradeBtn').addEventListener('click',submitTrade);
}

async function checkGate(){
  const symbol=qs('#tradeSymbol').value.trim().toUpperCase();
  const confidence=parseInt(qs('#tradeConfidence').value);
  const volatility=parseInt(qs('#tradeVolatility').value);
  const syncScore=parseInt(qs('#tradeSyncScore').value);
  const qty=parseInt(qs('#tradeQty').value);
  const side=qs('#tradeAction').value;
  const style=qs('#tradeStyle').value;
  const resultEl=qs('#tradeGateResult');
  const submitBtn=qs('#submitTradeBtn');
  const aiBox=qs('#aiAnalysisBox');
  if(!symbol){toast('Enter a stock symbol first','warn');return;}

  let price=0;
  try{
    const trade=await getLatestTrade(symbol);
    price=trade.trade?.p||trade.trade?.price||0;
    const cost=price*qty;
    qs('#quoteBox').innerHTML=`<div style="font-size:26px;font-weight:900;color:var(--gold)">${symbol}</div><div style="font-size:40px;font-weight:900">${fmtMoney(price)}</div><div style="color:var(--muted);font-size:12px">${qty} share${qty>1?'s':''} = ${fmtMoney(cost)}</div>`;
    qs('#riskBox').innerHTML=`<div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Position size</span><strong style="color:${cost<=RULES.maxPositionSize?'var(--green)':'#ff4f4f'}">${fmtMoney(cost)}</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Stop loss</span><strong>${fmtMoney(price-(RULES.maxLossPerTrade/qty))}</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Take profit</span><strong style="color:var(--green)">${fmtMoney(price+(RULES.takeProfitTarget/qty))}</strong></div>
    </div>`;
  }catch(e){qs('#quoteBox').innerHTML=`<p style="color:#ff4f4f;font-size:13px">Could not find ${symbol}. Check the symbol.</p>`;}

  const gate=checkSafetyGate(confidence,volatility,syncScore);
  resultEl.style.display='block';submitBtn.style.display='none';

  if(!gate.ok){
    resultEl.style.cssText='display:block;margin:12px 0;padding:14px;border-radius:14px;font-weight:800;font-size:13px;line-height:1.8;background:rgba(255,79,79,.07);border:1px solid rgba(255,79,79,.3);color:#ff4f4f';
    resultEl.innerHTML='🔴 TRADE BLOCKED<br><span style="font-weight:400;font-size:12px">'+gate.issues.join('<br>')+'</span>';
  }else if(gate.warns.length){
    resultEl.style.cssText='display:block;margin:12px 0;padding:14px;border-radius:14px;font-weight:800;font-size:13px;line-height:1.8;background:rgba(255,214,0,.07);border:1px solid rgba(255,214,0,.3);color:#ffd600';
    resultEl.innerHTML='🟡 PROCEED WITH CAUTION<br><span style="font-weight:400;font-size:12px">'+gate.warns.join('<br>')+'</span>';
    submitBtn.style.display='block';
  }else{
    resultEl.style.cssText='display:block;margin:12px 0;padding:14px;border-radius:14px;font-weight:800;font-size:13px;background:rgba(103,255,116,.07);border:1px solid rgba(103,255,116,.3);color:var(--green)';
    resultEl.innerHTML='🟢 ALL CLEAR — Trade approved for paper execution';
    submitBtn.style.display='block';
  }

  if(aiBox){
    aiBox.style.display='block';
    aiBox.innerHTML='<div style="background:#111722;border:1px solid #2c3546;border-radius:14px;padding:18px;color:var(--muted);font-size:13px;text-align:center">🤖 Precision Alpha AI is analyzing this trade...</div>';
    try{
      const analysis=await analyzeTradeWithAI(symbol,side,qty,price,confidence,volatility,syncScore,style);
      let bg='rgba(255,214,0,.06)',bc='rgba(255,214,0,.3)';
      if(analysis.includes('GOOD TRADE')){bg='rgba(103,255,116,.06)';bc='rgba(103,255,116,.3)';}
      if(analysis.includes('BAD TRADE')){bg='rgba(255,79,79,.06)';bc='rgba(255,79,79,.3)';}
      aiBox.innerHTML=`<div style="background:${bg};border:1px solid ${bc};border-radius:16px;padding:20px"><div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:12px">🤖 AI Analysis · ${style} Style</div><div style="font-size:13px;line-height:1.8;color:#eef2f6">${analysis.replace(/

/g,'<br><br>').replace(/
/g,'<br>')}</div></div>`;
    }catch(e){aiBox.innerHTML='<div style="background:#111722;border:1px solid #2c3546;border-radius:14px;padding:14px;color:var(--muted);font-size:13px">AI analysis unavailable. Check connection.</div>';}
  }
}

async function submitTrade(){
  const symbol=qs('#tradeSymbol').value.trim().toUpperCase();
  const side=qs('#tradeAction').value;
  const qty=parseInt(qs('#tradeQty').value);
  const orderType=qs('#tradeOrderType').value;
  const limitPx=qs('#tradeLimitPrice')?.value;
  if(!symbol||!qty){toast('Fill in symbol and quantity','warn');return;}
  if(state.killed){toast('Kill switch is active!','error');return;}
  const order={symbol,qty:qty.toString(),side,type:orderType,time_in_force:'day'};
  if(orderType==='limit'&&limitPx)order.limit_price=limitPx;
  try{
    qs('#submitTradeBtn').textContent='Placing order...';
    await alpaca('/orders','POST',order);
    toast(`✅ Paper order placed: ${side.toUpperCase()} ${qty} ${symbol}`,'success');
    state.weeklyTrades.push({symbol,side,qty,time:new Date().toISOString()});
    localStorage.setItem('pa_weekly_trades',JSON.stringify(state.weeklyTrades));
    qs('#submitTradeBtn').textContent='⚡ Submit Paper Trade';
    qs('#tradeGateResult').style.display='none';
    qs('#submitTradeBtn').style.display='none';
    qs('#tradeSymbol').value='';
  }catch(e){toast('Order failed: '+e.message,'error');qs('#submitTradeBtn').textContent='⚡ Submit Paper Trade';}
}

function activateKill(){
  if(state.killed){if(confirm('Reactivate trading system?')){state.killed=false;qs('#killBtn').textContent='⛔ KILL SWITCH';qs('#killBtn').style.background='rgba(255,79,79,.1)';toast('System reactivated','success');}}
  else{if(confirm('Activate kill switch? This stops all trading immediately.')){state.killed=true;qs('#killBtn').textContent='✅ KILLED — Click to Restart';qs('#killBtn').style.background='rgba(255,79,79,.3)';toast('⛔ Kill switch activated','error');}}
}


function showView(id){
  qsa('.view').forEach(v=>v.classList.remove('active'));
  qsa('.nav').forEach(n=>n.classList.remove('active'));
  qs('#'+id)?.classList.add('active');
  qsa('.nav').find(n=>n.dataset.view===id)?.classList.add('active');
}
function notes(id,items){
  const el=qs('#'+id);
  if(!el)return;
  el.innerHTML=items.map(x=>`<div class="note">${x}</div>`).join('');
}
function loadFeed(){
  notes('feed',['X24 Autonomous Route Intelligence online.','X25 Volatility Containment Engine active.','X26 Institutional Synchronization Layer aligned.','Alpaca paper trading connected. Safety rules active.','Real-money execution remains disabled.']);
}
function runConfidence(){
  const v=Number(qs('#confidenceRange').value);
  qs('#confidenceValue').textContent=v;
  let msg='Entry window still valid for paper review.';
  if(v<65) msg='Confidence decayed. Use replay/watchlist only.';
  if(v>88) msg='Strong window, but confirmation is still required.';
  notes('confidenceOutput',[`Confidence score: ${v}`,msg,'Live execution remains disabled.']);
}
function runRoute(){
  const type=qs('#routeType').value;
  const c=Number(qs('#routeConfidence').value);
  qs('#routeConfidenceValue').textContent=c;
  let decision='Route may proceed to paper approval.';
  if(type==='Replay Only') decision='Route diverted to replay.';
  if(c<65) decision='Confidence weak. Watchlist only.';
  if(c>90) decision='Strong confidence, but no chasing. Confirmation required.';
  notes('routeOutput',[`Route type: ${type}`,`Confidence: ${c}`,decision]);
}
function runContain(){
  const p=Number(qs('#volPressure').value);
  const mode=qs('#containMode').value;
  qs('#volPressureValue').textContent=p;
  let msg='Volatility contained.';
  if(p>70) msg='Volatility elevated. Reduce route aggression.';
  if(p>88) msg='High volatility. Defense/replay mode recommended.';
  if(mode==='Defense Mode') msg='Defense mode active. Block aggressive routing.';
  if(mode==='Replay Enforcement') msg='Replay enforcement active. No new route escalation.';
  notes('containOutput',[`Volatility pressure: ${p}`,`Containment mode: ${mode}`,msg]);
}
function runSync(){
  const pairs=[['timingSync','timingSyncInput'],['riskSync','riskSyncInput'],['replaySync','replaySyncInput'],['routeSync','routeSyncInput']];
  let total=0;
  pairs.forEach(([o,i])=>{const v=Number(qs('#'+i).value); qs('#'+o).textContent=v; total+=v;});
  const score=Math.round(total/4);
  let msg='Synchronization stable.';
  if(score>=88) msg='High synchronization quality.';
  if(score<70) msg='Synchronization weak. Send to replay before route.';
  notes('syncOutput',[`Synchronization score: ${score}`,msg,'Live broker execution remains disabled.']);
}
function runGate(){
  const req=qs('#executionRequest').value;
  const safety=qs('#systemSafety').value;
  let decision='APPROVED FOR PAPER WATCH — confirmation required.';
  if(req==='Send to Paper Queue') decision='SENT TO PAPER QUEUE.';
  if(req==='Replay Before Route') decision='DIVERTED TO REPLAY BEFORE ROUTE.';
  if(req==='Block Route') decision='BLOCKED BY EXECUTION GATE.';
  if(safety==='Elevated Risk') decision='LIMITED — stronger confirmation required.';
  if(safety==='Volatility Defense') decision='BLOCKED — volatility defense active.';
  if(safety==='Replay Only') decision='BLOCKED — replay-only mode active.';
  notes('gateOutput',[`Execution request: ${req}`,`System safety: ${safety}`,`Decision: ${decision}`,'Real-money execution remains disabled.']);
}
function getStore(k){return JSON.parse(localStorage.getItem(k)||'[]')}
function setStore(k,v){localStorage.setItem(k,JSON.stringify(v.slice(0,20)))}
function renderReplay(){
  const items=getStore('x26_replay');
  const el=qs('#replayLog');
  if(el)el.innerHTML=items.length?items.map(x=>`<div class="logitem">${x}</div>`).join(''):'<div class="logitem">No replay entries saved yet.</div>';
}
function renderJournal(){
  const items=getStore('x26_journal');
  const el=qs('#journalLog');
  if(el)el.innerHTML=items.length?items.map(x=>`<div class="logitem">${x}</div>`).join(''):'<div class="logitem">No journal entries saved yet.</div>';
}
function saveReplay(){
  const note=qs('#replayNote').value.trim();
  const result=qs('#replayResult').value;
  if(!note){alert('Type a replay note first.');return;}
  const items=getStore('x26_replay');
  items.unshift(`${result}: ${note} — ${new Date().toLocaleString()}`);
  setStore('x26_replay',items);
  qs('#replayNote').value='';
  renderReplay();
}
function saveJournal(){
  const ticker=(qs('#journalTicker').value||'TICKER').toUpperCase();
  const setup=qs('#journalSetup').value;
  const note=qs('#journalNote').value.trim();
  if(!note){alert('Type a journal note first.');return;}
  const items=getStore('x26_journal');
  items.unshift(`${ticker} • ${setup}: ${note} — ${new Date().toLocaleString()}`);
  setStore('x26_journal',items);
  qs('#journalTicker').value='';
  qs('#journalNote').value='';
  renderJournal();
}
window.addEventListener('load',()=>{
  buildTradeView();
  loadAccountData();
  qsa('.nav').forEach(n=>n.addEventListener('click',()=>showView(n.dataset.view)));
  loadFeed(); runConfidence(); runRoute(); runContain(); runSync(); runGate(); renderReplay(); renderJournal();
  qs('#runConfidence').addEventListener('click',runConfidence); qs('#confidenceRange').addEventListener('input',runConfidence);
  qs('#runRoute').addEventListener('click',runRoute); qs('#routeType').addEventListener('change',runRoute); qs('#routeConfidence').addEventListener('input',runRoute);
  qs('#runContain').addEventListener('click',runContain); qs('#volPressure').addEventListener('input',runContain); qs('#containMode').addEventListener('change',runContain);
  qs('#runSync').addEventListener('click',runSync); ['timingSyncInput','riskSyncInput','replaySyncInput','routeSyncInput'].forEach(id=>qs('#'+id).addEventListener('input',runSync));
  qs('#runGate').addEventListener('click',runGate); qs('#executionRequest').addEventListener('change',runGate); qs('#systemSafety').addEventListener('change',runGate);
  qs('#saveReplay').addEventListener('click',saveReplay); qs('#clearReplay').addEventListener('click',()=>{localStorage.removeItem('x26_replay');renderReplay();});
  qs('#saveJournal').addEventListener('click',saveJournal);
});
