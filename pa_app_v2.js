const qs=(s)=>document.querySelector(s);
const qsa=(s)=>Array.from(document.querySelectorAll(s));

// ── CONFIG ────────────────────────────────────────────────────────────────────
const ALPACA_KEY    = 'PKOKJQWTT4NSZ64VGBN7GLEP6T';
const ALPACA_SECRET = 'FonC1S7yhNZEx1p9Auscbs5s6qcTt4U4isjnwearYkad';
const BASE_URL      = 'https://paper-api.alpaca.markets/v2';
const DATA_URL      = 'https://data.alpaca.markets/v2';
const EMAILJS_PUBLIC  = 'i9a72iQL0ChaDHoZL';
const EMAILJS_SERVICE = 'service_rucosmz';
const EMAILJS_TEMPLATE= 'template_qajvk5t';
const ALERT_EMAIL     = 'pinnacleperformancetax@gmail.com';

// ── SAFETY RULES ──────────────────────────────────────────────────────────────
const RULES = {
  maxDailyLoss:50, maxTrades:3, maxPositionSize:200,
  maxLossPerTrade:15, takeProfitTarget:30,
  minConfidence:75, maxVolatility:70, minSyncScore:75,
  tradeStartHour:10, tradeEndHour:15, tradeEndMinute:30
};

// Default watchlist
const DEFAULT_WATCHLIST = ['AAPL','TSLA','NVDA','SPY','QQQ','MSFT','AMD','META'];
const MARKET_SCAN_LIST  = ['AAPL','TSLA','NVDA','SPY','QQQ','MSFT','AMD','META','GOOGL','AMZN','NFLX','SOFI','PLTR','RIVN','COIN'];

// ── STATE ─────────────────────────────────────────────────────────────────────
let state = {
  killed: false,
  autoRunning: false,
  autoInterval: null,
  weeklyTrades: JSON.parse(localStorage.getItem('pa_weekly_trades')||'[]'),
  todayPL: parseFloat(localStorage.getItem('pa_today_pl')||'0'),
  watchlist: JSON.parse(localStorage.getItem('pa_watchlist')||JSON.stringify(DEFAULT_WATCHLIST)),
  autoLog: JSON.parse(localStorage.getItem('pa_auto_log')||'[]'),
};

const today = new Date().toDateString();
if(localStorage.getItem('pa_last_date')!==today){state.todayPL=0;localStorage.setItem('pa_today_pl','0');localStorage.setItem('pa_last_date',today);}
function getWeekKey(){const d=new Date(),day=d.getDay(),diff=d.getDate()-day+(day===0?-6:1);return new Date(d.setDate(diff)).toDateString();}
if(localStorage.getItem('pa_week_key')!==getWeekKey()){state.weeklyTrades=[];localStorage.setItem('pa_weekly_trades','[]');localStorage.setItem('pa_week_key',getWeekKey());}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fmtMoney(v){const n=parseFloat(v)||0;return(n<0?'-$':'$')+Math.abs(n).toFixed(2);}
function isMarketHours(){const now=new Date(),est=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'})),h=est.getHours(),m=est.getMinutes();return(h>RULES.tradeStartHour||(h===RULES.tradeStartHour))&&(h<RULES.tradeEndHour||(h===RULES.tradeEndHour&&m<=RULES.tradeEndMinute));}
function getStore(k){return JSON.parse(localStorage.getItem(k)||'[]');}
function setStore(k,v){localStorage.setItem(k,JSON.stringify(v.slice?v.slice(0,30):v));}
function showView(id){qsa('.view').forEach(v=>v.classList.remove('active'));qsa('.nav').forEach(n=>n.classList.remove('active'));qs('#'+id)?.classList.add('active');qsa('.nav').find(n=>n.dataset.view===id)?.classList.add('active');}
function notes(id,items){const el=qs('#'+id);if(!el)return;el.innerHTML=items.map(x=>`<div class="note">${x}</div>`).join('');}
function toast(msg,type='success'){
  let el=qs('#paToast');
  if(!el){el=document.createElement('div');el.id='paToast';el.style.cssText='position:fixed;bottom:24px;right:24px;padding:14px 20px;border-radius:14px;font-weight:800;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:9999;max-width:340px;background:#0d1117;border:1px solid #202838;color:#f7f7f7';document.body.appendChild(el);}
  el.textContent=msg;el.style.opacity='1';
  if(type==='success')el.style.borderColor='rgba(103,255,116,.4)';
  else if(type==='error')el.style.borderColor='rgba(255,79,79,.4)';
  else el.style.borderColor='rgba(255,214,0,.4)';
  setTimeout(()=>el.style.opacity='0',3500);
}

// ── ALPACA ────────────────────────────────────────────────────────────────────
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
async function getBars(symbol){
  const end=new Date().toISOString();
  const start=new Date(Date.now()-2*24*60*60*1000).toISOString();
  const res=await fetch(`${DATA_URL}/stocks/${symbol}/bars?timeframe=1Day&start=${start}&end=${end}&limit=5`,{headers:{'APCA-API-KEY-ID':ALPACA_KEY,'APCA-API-SECRET-KEY':ALPACA_SECRET}});
  if(!res.ok)return null;
  return res.json();
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────
async function sendTradeEmail(symbol,side,qty,price,reason,verdict){
  try{
    if(typeof emailjs==='undefined'){console.warn('EmailJS not loaded');return;}
    await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
      to_email: ALERT_EMAIL,
      subject: `🤖 Precision Alpha: ${verdict} — ${side.toUpperCase()} ${qty} ${symbol}`,
      trade_symbol: symbol,
      trade_side: side.toUpperCase(),
      trade_qty: qty,
      trade_price: fmtMoney(price),
      trade_total: fmtMoney(price*qty),
      trade_reason: reason,
      trade_verdict: verdict,
      trade_time: new Date().toLocaleString('en-US',{timeZone:'America/New_York'})+' EST',
      stop_loss: fmtMoney(price-(RULES.maxLossPerTrade/qty)),
      take_profit: fmtMoney(price+(RULES.takeProfitTarget/qty)),
    });
    console.log('Trade email sent');
  }catch(e){console.error('Email failed:',e);}
}

// ── AI ANALYZER ───────────────────────────────────────────────────────────────
async function analyzeTradeWithAI(symbol,side,qty,price,confidence,volatility,syncScore,style,barData){
  const priceChange = barData ? ((barData.bars?.[1]?.c||price)-(barData.bars?.[0]?.c||price)).toFixed(2) : 'N/A';
  const prompt=`You are Precision Alpha AI, an expert trading analyst. Analyze this paper trade and give a clear verdict.

TRADE: ${side.toUpperCase()} ${qty} shares of ${symbol} at $${price.toFixed(2)} (total $${(price*qty).toFixed(2)})
STYLE: ${style}
SIGNALS: X24 Confidence ${confidence}/100 · X25 Volatility ${volatility}/100 · X26 Sync ${syncScore}/100
PRICE CHANGE (2 days): $${priceChange}
RULES: Max loss $${RULES.maxLossPerTrade}/trade · Target profit $${RULES.takeProfitTarget}/trade · Max position $${RULES.maxPositionSize}

Provide exactly:
1. VERDICT: "✅ GOOD TRADE" or "⚠️ RISKY TRADE" or "❌ BAD TRADE"
2. SCORE: 0-100
3. REASON: 2-3 simple sentences. No jargon.
4. STOP LOSS: specific exit price if wrong
5. TAKE PROFIT: specific exit price when profitable
6. TIP: one actionable tip

Be direct and honest. Simple language anyone can understand.`;
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:500,messages:[{role:'user',content:prompt}]})});
  const data=await response.json();
  return data.content[0].text;
}

// Quick AI check for auto-scanner (faster, simpler prompt)
async function quickAICheck(symbol,price,priceChange,volume){
  const prompt=`You are Precision Alpha AI auto-scanner. Evaluate this stock for a paper trade setup.

Stock: ${symbol} | Price: $${price.toFixed(2)} | 1-day change: $${priceChange.toFixed(2)} (${((priceChange/price)*100).toFixed(1)}%)

Based on momentum and price action, respond with ONLY a JSON object (no markdown):
{"confidence":0-100,"volatility":0-100,"sync":0-100,"side":"buy" or "sell","reason":"one sentence"}

Rules: confidence>75, volatility<70, sync>75 required to trade. Be conservative.`;
  const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:150,messages:[{role:'user',content:prompt}]})});
  const data=await response.json();
  const text=data.content[0].text.replace(/```json|```/g,'').trim();
  return JSON.parse(text);
}

// ── SAFETY GATE ───────────────────────────────────────────────────────────────
function checkSafetyGate(confidence,volatility,syncScore){
  const issues=[];const warns=[];
  if(state.killed) issues.push('⛔ Kill switch is active');
  if(state.todayPL<=-RULES.maxDailyLoss) issues.push(`Daily loss limit hit (${fmtMoney(state.todayPL)})`);
  if(state.weeklyTrades.length>=RULES.maxTrades) issues.push(`Weekly trade limit (${state.weeklyTrades.length}/${RULES.maxTrades})`);
  if(!isMarketHours()) issues.push('Outside trading hours (10am–3:30pm EST)');
  if(confidence<RULES.minConfidence) issues.push(`Confidence too low (${confidence}<${RULES.minConfidence})`);
  if(volatility>RULES.maxVolatility) issues.push(`Volatility too high (${volatility}>${RULES.maxVolatility})`);
  if(syncScore<RULES.minSyncScore) issues.push(`Sync too low (${syncScore}<${RULES.minSyncScore})`);
  if(confidence<80&&confidence>=RULES.minConfidence) warns.push(`Confidence borderline (${confidence})`);
  if(volatility>60&&volatility<=RULES.maxVolatility) warns.push(`Volatility elevated (${volatility})`);
  return{ok:issues.length===0,issues,warns};
}

// ── AUTO EXECUTION ENGINE ─────────────────────────────────────────────────────
async function autoScanAndTrade(){
  if(!isMarketHours()){logAutoEvent('⏰ Outside trading hours — scan skipped');return;}
  if(state.killed){logAutoEvent('⛔ Kill switch active — scan skipped');return;}
  if(state.todayPL<=-RULES.maxDailyLoss){logAutoEvent(`🔴 Daily loss limit hit — no more trades today`);return;}
  if(state.weeklyTrades.length>=RULES.maxTrades){logAutoEvent(`🔴 Weekly trade limit reached (${RULES.maxTrades})`);return;}

  // Combine watchlist + market scan
  const allSymbols=[...new Set([...state.watchlist,...MARKET_SCAN_LIST])];
  logAutoEvent(`🔍 Scanning ${allSymbols.length} stocks...`);

  for(const symbol of allSymbols){
    if(state.weeklyTrades.length>=RULES.maxTrades) break;
    try{
      // Get price data
      const tradeData=await getLatestTrade(symbol);
      const price=tradeData.trade?.p||tradeData.trade?.price||0;
      const barData=await getBars(symbol);
      const bars=barData?.bars||[];
      const priceChange=bars.length>=2?(bars[bars.length-1].c-bars[bars.length-2].c):0;

      // Skip if price outside safe range ($5-$150)
      if(price<5||price>150){continue;}

      // Quick AI check
      let aiCheck;
      try{aiCheck=await quickAICheck(symbol,price,priceChange,0);}
      catch(e){continue;}

      const gate=checkSafetyGate(aiCheck.confidence,aiCheck.volatility,aiCheck.sync);
      if(!gate.ok){
        logAutoEvent(`⚫ ${symbol} — blocked: ${gate.issues[0]}`);
        continue;
      }

      // All clear — place the trade
      const qty=Math.floor(RULES.maxPositionSize/price)||1;
      logAutoEvent(`✅ ${symbol} — ${aiCheck.side.toUpperCase()} signal found. Placing order...`);

      try{
        const order=await alpaca('/orders','POST',{symbol,qty:qty.toString(),side:aiCheck.side,type:'market',time_in_force:'day'});
        state.weeklyTrades.push({symbol,side:aiCheck.side,qty,price,time:new Date().toISOString(),auto:true,orderId:order.id});
        localStorage.setItem('pa_weekly_trades',JSON.stringify(state.weeklyTrades));

        const logEntry=`${new Date().toLocaleTimeString()} · AUTO: ${aiCheck.side.toUpperCase()} ${qty} ${symbol} @ ${fmtMoney(price)} · ${aiCheck.reason}`;
        state.autoLog.unshift(logEntry);
        state.autoLog=state.autoLog.slice(0,50);
        localStorage.setItem('pa_auto_log',JSON.stringify(state.autoLog));

        logAutoEvent(`🚀 ORDER PLACED: ${aiCheck.side.toUpperCase()} ${qty} ${symbol} @ ${fmtMoney(price)}`);
        toast(`🤖 Auto trade: ${aiCheck.side.toUpperCase()} ${qty} ${symbol}`,'success');

        // Send email
        await sendTradeEmail(symbol,aiCheck.side,qty,price,aiCheck.reason,'AUTO TRADE');
        renderAutoLog();
        // Only one trade per scan cycle
        break;
      }catch(orderErr){
        logAutoEvent(`❌ ${symbol} — order failed: ${orderErr.message}`);
      }
    }catch(e){
      continue;
    }
    // Small delay between stocks
    await new Promise(r=>setTimeout(r,500));
  }
  logAutoEvent(`✓ Scan complete — next scan in 5 minutes`);
}

function logAutoEvent(msg){
  const el=qs('#autoFeed');
  if(!el)return;
  const div=document.createElement('div');
  div.className='logitem';
  div.textContent=`${new Date().toLocaleTimeString()} — ${msg}`;
  el.insertBefore(div,el.firstChild);
  // Keep only last 30
  while(el.children.length>30)el.removeChild(el.lastChild);
}

function startAutoEngine(){
  if(state.autoRunning)return;
  state.autoRunning=true;
  const btn=qs('#autoStartBtn');
  if(btn){btn.textContent='⏹ Stop Auto Engine';btn.style.background='rgba(255,79,79,.2)';btn.style.color='#ff4f4f';btn.style.border='1px solid rgba(255,79,79,.4)';}
  const dot=qs('#autoDot');if(dot){dot.style.background='#67ff74';dot.style.boxShadow='0 0 8px #67ff74';}
  const status=qs('#autoStatus');if(status)status.textContent='AUTO ENGINE RUNNING — scanning every 5 minutes';
  logAutoEvent('🚀 Auto execution engine started');
  // Run immediately then every 5 minutes
  autoScanAndTrade();
  state.autoInterval=setInterval(autoScanAndTrade,5*60*1000);
  toast('🤖 Auto engine started — scanning every 5 minutes','success');
}

function stopAutoEngine(){
  state.autoRunning=false;
  if(state.autoInterval){clearInterval(state.autoInterval);state.autoInterval=null;}
  const btn=qs('#autoStartBtn');
  if(btn){btn.textContent='▶ Start Auto Engine';btn.style.background='linear-gradient(180deg,#f2bf4b,#c88d1f)';btn.style.color='#111';btn.style.border='none';}
  const dot=qs('#autoDot');if(dot){dot.style.background='#a8b0bd';dot.style.boxShadow='none';}
  const status=qs('#autoStatus');if(status)status.textContent='AUTO ENGINE STOPPED';
  logAutoEvent('⏹ Auto execution engine stopped');
  toast('Auto engine stopped','warn');
}

function renderAutoLog(){
  const el=qs('#autoTradeLog');
  if(!el)return;
  el.innerHTML=state.autoLog.length
    ?state.autoLog.map(x=>`<div class="logitem">${x}</div>`).join('')
    :'<div class="logitem">No auto trades yet.</div>';
}

function renderWatchlist(){
  const el=qs('#watchlistTags');
  if(!el)return;
  el.innerHTML=state.watchlist.map(s=>`<span class="wtag">${s}<button onclick="removeFromWatchlist('${s}')" style="background:none;border:none;color:#ff4f4f;cursor:pointer;margin-left:4px;font-weight:900">×</button></span>`).join('');
}

function addToWatchlist(){
  const input=qs('#watchlistInput');
  const sym=(input?.value||'').trim().toUpperCase();
  if(!sym){toast('Enter a symbol','warn');return;}
  if(state.watchlist.includes(sym)){toast(`${sym} already in watchlist`,'warn');return;}
  if(state.watchlist.length>=20){toast('Max 20 symbols in watchlist','warn');return;}
  state.watchlist.push(sym);
  localStorage.setItem('pa_watchlist',JSON.stringify(state.watchlist));
  input.value='';
  renderWatchlist();
  toast(`${sym} added to watchlist`,'success');
}

function removeFromWatchlist(sym){
  state.watchlist=state.watchlist.filter(s=>s!==sym);
  localStorage.setItem('pa_watchlist',JSON.stringify(state.watchlist));
  renderWatchlist();
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
async function loadAccountData(){
  try{
    const acct=await alpaca('/account');
    const equity=parseFloat(acct.equity);
    const pl=equity-parseFloat(acct.last_equity);
    state.todayPL=pl;localStorage.setItem('pa_today_pl',pl.toString());
    const balEl=qs('#acctBalance');if(balEl)balEl.textContent=fmtMoney(equity);
    const plEl=qs('#acctPL');if(plEl){plEl.textContent=fmtMoney(pl);plEl.style.color=pl>=0?'var(--green)':'#ff4f4f';}
    const trEl=qs('#acctTrades');if(trEl)trEl.textContent=`${state.weeklyTrades.length} / ${RULES.maxTrades}`;
  }catch(e){console.error('Alpaca load failed:',e);}
}

// ── MANUAL TRADE ──────────────────────────────────────────────────────────────
function buildTradeView(){
  const existing=qs('#trade');if(existing)return;
  const sidebar=qs('.sidebar');
  // Add nav buttons
  const firstNav=qs('.nav');
  if(firstNav){
    const tradeBtn=document.createElement('button');
    tradeBtn.className='nav';tradeBtn.dataset.view='trade';tradeBtn.textContent='Place Trade';
    firstNav.parentNode.insertBefore(tradeBtn,firstNav.nextSibling);
    tradeBtn.addEventListener('click',()=>showView('trade'));
    const autoBtn=document.createElement('button');
    autoBtn.className='nav';autoBtn.dataset.view='auto';autoBtn.textContent='🤖 Auto Engine';
    tradeBtn.parentNode.insertBefore(autoBtn,tradeBtn.nextSibling);
    autoBtn.addEventListener('click',()=>{showView('auto');renderWatchlist();renderAutoLog();});
  }
  // Kill switch
  if(sidebar&&!qs('#killBtn')){
    const kw=document.createElement('div');kw.style.cssText='margin-top:16px;padding-top:16px;border-top:1px solid #202838';
    kw.innerHTML='<button id="killBtn" style="width:100%;padding:12px 14px;background:rgba(255,79,79,.1);color:#ff4f4f;border:1px solid rgba(255,79,79,.3);border-radius:13px;font-weight:900;cursor:pointer;font-size:13px">⛔ KILL SWITCH</button>';
    sidebar.appendChild(kw);
    qs('#killBtn').addEventListener('click',activateKill);
  }

  // Trade section
  const main=qs('.main');
  const tradeSection=document.createElement('section');
  tradeSection.id='trade';tradeSection.className='view';
  tradeSection.innerHTML=`
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
    <div id="tradeGateResult" style="display:none;margin:12px 0;padding:14px;border-radius:14px;font-weight:800;font-size:13px;line-height:1.8"></div>
    <button class="gold" id="checkGateBtn" style="width:100%">🔍 Check Gate + AI Analysis</button>
    <button id="submitTradeBtn" style="display:none;width:100%;margin-top:8px;padding:13px;background:linear-gradient(180deg,#7fff8a,#3dd44a);border:0;border-radius:13px;font-weight:900;cursor:pointer;font-size:14px;color:#0a1a0a">⚡ Submit Paper Trade</button>
  </div>
  <div>
    <div class="panel"><strong style="display:block;margin-bottom:10px;color:var(--muted);font-size:13px">📊 LIVE QUOTE</strong><div id="quoteBox"><p style="color:var(--muted);font-size:13px">Enter a symbol and check the gate.</p></div></div>
    <div class="panel"><strong style="display:block;margin-bottom:10px;color:var(--muted);font-size:13px">⚠️ RISK CALCULATOR</strong><div id="riskBox"><p style="color:var(--muted);font-size:13px">Set quantity to calculate risk.</p></div></div>
    <div id="aiAnalysisBox" style="display:none"></div>
  </div>
</div>`;
  const firstSection=qs('.main section');
  if(firstSection)main.insertBefore(tradeSection,firstSection);else main.appendChild(tradeSection);

  // Auto engine section
  const autoSection=document.createElement('section');
  autoSection.id='auto';autoSection.className='view';
  autoSection.innerHTML=`
<h2>🤖 Auto Execution Engine</h2>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">
  <div class="panel">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div id="autoDot" style="width:10px;height:10px;border-radius:50%;background:#a8b0bd;flex-shrink:0"></div>
      <strong id="autoStatus" style="font-size:13px;color:var(--muted)">AUTO ENGINE STOPPED</strong>
    </div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:16px;line-height:1.6">The auto engine scans your watchlist + top market stocks every 5 minutes during trading hours. When all safety rules are met, it places a paper trade automatically and emails you.</p>
    <div style="background:#070a0f;border:1px solid #202838;border-radius:12px;padding:14px;margin-bottom:16px;font-size:13px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--muted)">Scan frequency</span><strong>Every 5 minutes</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--muted)">Alert email</span><strong style="font-size:11px">pinnacleperformancetax@gmail.com</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--muted)">Daily loss limit</span><strong>$${RULES.maxDailyLoss}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="color:var(--muted)">Weekly trade limit</span><strong>${RULES.maxTrades} trades</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Trading hours</span><strong>10am–3:30pm EST</strong></div>
    </div>
    <button id="autoStartBtn" class="gold" style="width:100%;margin-bottom:8px">▶ Start Auto Engine</button>
    <p style="color:#ff4f4f;font-size:11px;text-align:center;margin:0">⚠️ Paper trading only. Real money execution is disabled.</p>
  </div>
  <div class="panel">
    <strong style="display:block;margin-bottom:12px;font-size:13px;color:var(--muted)">MY WATCHLIST</strong>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <input type="text" id="watchlistInput" placeholder="Add symbol e.g. AAPL" style="margin:0;flex:1"/>
      <button class="gold" onclick="addToWatchlist()" style="padding:12px 16px;white-space:nowrap">Add</button>
    </div>
    <div id="watchlistTags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px"></div>
    <p style="color:var(--muted);font-size:12px">The engine also scans top market movers automatically.</p>
  </div>
</div>
<div class="panel">
  <strong style="display:block;margin-bottom:12px;font-size:13px;color:var(--muted)">📡 LIVE SCAN FEED</strong>
  <div id="autoFeed" style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto">
    <div class="logitem">Auto engine not started yet.</div>
  </div>
</div>
<div class="panel">
  <strong style="display:block;margin-bottom:12px;font-size:13px;color:var(--muted)">🚀 AUTO TRADE LOG</strong>
  <div id="autoTradeLog"><div class="logitem">No auto trades yet.</div></div>
</div>`;
  if(firstSection)main.insertBefore(autoSection,firstSection);else main.appendChild(autoSection);

  // Add watchlist tag styles
  const style=document.createElement('style');
  style.textContent='.wtag{display:inline-flex;align-items:center;background:#151a23;border:1px solid #343b4b;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;color:var(--gold)}';
  document.head.appendChild(style);

  // Events - trade
  qs('#tradeSymbol').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase());
  qs('#tradeOrderType').addEventListener('change',()=>{qs('#limitPriceGroup').style.display=qs('#tradeOrderType').value==='limit'?'block':'none';});
  qs('#tradeConfidence').addEventListener('input',e=>qs('#tradeConfidenceVal').textContent=e.target.value);
  qs('#tradeVolatility').addEventListener('input',e=>qs('#tradeVolatilityVal').textContent=e.target.value);
  qs('#tradeSyncScore').addEventListener('input',e=>qs('#tradeSyncVal').textContent=e.target.value);
  qs('#checkGateBtn').addEventListener('click',checkGate);
  qs('#submitTradeBtn').addEventListener('click',submitTrade);
  // Events - auto
  qs('#autoStartBtn').addEventListener('click',()=>{state.autoRunning?stopAutoEngine():startAutoEngine();});
  qs('#watchlistInput').addEventListener('keydown',e=>{if(e.key==='Enter')addToWatchlist();});
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

  let price=0,barData=null;
  try{
    const trade=await getLatestTrade(symbol);
    price=trade.trade?.p||trade.trade?.price||0;
    barData=await getBars(symbol);
    const cost=price*qty;
    qs('#quoteBox').innerHTML=`<div style="font-size:26px;font-weight:900;color:var(--gold)">${symbol}</div><div style="font-size:40px;font-weight:900">${fmtMoney(price)}</div><div style="color:var(--muted);font-size:12px">${qty} share${qty>1?'s':''} = ${fmtMoney(cost)}</div>`;
    qs('#riskBox').innerHTML=`<div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Position size</span><strong style="color:${cost<=RULES.maxPositionSize?'var(--green)':'#ff4f4f'}">${fmtMoney(cost)}</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Stop loss</span><strong>${fmtMoney(price-(RULES.maxLossPerTrade/qty))}</strong></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Take profit</span><strong style="color:var(--green)">${fmtMoney(price+(RULES.takeProfitTarget/qty))}</strong></div>
    </div>`;
  }catch(e){qs('#quoteBox').innerHTML=`<p style="color:#ff4f4f;font-size:13px">Could not find ${symbol}.</p>`;}

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
      const analysis=await analyzeTradeWithAI(symbol,side,qty,price,confidence,volatility,syncScore,style,barData);
      let bg='rgba(255,214,0,.06)',bc='rgba(255,214,0,.3)';
      if(analysis.includes('GOOD TRADE')){bg='rgba(103,255,116,.06)';bc='rgba(103,255,116,.3)';}
      if(analysis.includes('BAD TRADE')){bg='rgba(255,79,79,.06)';bc='rgba(255,79,79,.3)';}
      aiBox.innerHTML=`<div style="background:${bg};border:1px solid ${bc};border-radius:16px;padding:20px"><div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:12px">🤖 AI Analysis · ${style} Style</div><div style="font-size:13px;line-height:1.8;color:#eef2f6">${analysis.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>')}</div></div>`;
    }catch(e){aiBox.innerHTML='<div style="background:#111722;border:1px solid #2c3546;border-radius:14px;padding:14px;color:var(--muted);font-size:13px">AI analysis unavailable.</div>';}
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
    const result=await alpaca('/orders','POST',order);
    state.weeklyTrades.push({symbol,side,qty,time:new Date().toISOString(),orderId:result.id});
    localStorage.setItem('pa_weekly_trades',JSON.stringify(state.weeklyTrades));
    toast(`✅ Paper order: ${side.toUpperCase()} ${qty} ${symbol}`,'success');
    await sendTradeEmail(symbol,side,qty,0,'Manual trade placed','MANUAL TRADE');
    qs('#submitTradeBtn').textContent='⚡ Submit Paper Trade';
    qs('#tradeGateResult').style.display='none';
    qs('#submitTradeBtn').style.display='none';
    qs('#tradeSymbol').value='';
  }catch(e){toast('Order failed: '+e.message,'error');qs('#submitTradeBtn').textContent='⚡ Submit Paper Trade';}
}

function activateKill(){
  if(state.autoRunning)stopAutoEngine();
  if(state.killed){if(confirm('Reactivate trading system?')){state.killed=false;qs('#killBtn').textContent='⛔ KILL SWITCH';qs('#killBtn').style.background='rgba(255,79,79,.1)';toast('System reactivated','success');}}
  else{if(confirm('Activate kill switch? This stops ALL trading immediately.')){state.killed=true;qs('#killBtn').textContent='✅ KILLED — Click to Restart';qs('#killBtn').style.background='rgba(255,79,79,.3)';toast('⛔ Kill switch activated','error');}}
}

// ── ORIGINAL FUNCTIONS ────────────────────────────────────────────────────────
function loadFeed(){notes('feed',['X24 Autonomous Route Intelligence online.','X25 Volatility Containment Engine active.','X26 Institutional Synchronization Layer aligned.','Auto execution engine ready — go to 🤖 Auto Engine to start.','Real-money execution remains disabled.']);}
function runConfidence(){const v=Number(qs('#confidenceRange').value);qs('#confidenceValue').textContent=v;let msg='Entry window still valid for paper review.';if(v<65)msg='Confidence decayed. Use replay/watchlist only.';if(v>88)msg='Strong window, but confirmation is still required.';notes('confidenceOutput',[`Confidence score: ${v}`,msg,'Live execution remains disabled.']);}
function runRoute(){const type=qs('#routeType').value,c=Number(qs('#routeConfidence').value);qs('#routeConfidenceValue').textContent=c;let d='Route may proceed to paper approval.';if(type==='Replay Only')d='Route diverted to replay.';if(c<65)d='Confidence weak. Watchlist only.';if(c>90)d='Strong confidence, but no chasing. Confirmation required.';notes('routeOutput',[`Route type: ${type}`,`Confidence: ${c}`,d]);}
function runContain(){const p=Number(qs('#volPressure').value),mode=qs('#containMode').value;qs('#volPressureValue').textContent=p;let msg='Volatility contained.';if(p>70)msg='Volatility elevated. Reduce route aggression.';if(p>88)msg='High volatility. Defense/replay mode recommended.';if(mode==='Defense Mode')msg='Defense mode active. Block aggressive routing.';if(mode==='Replay Enforcement')msg='Replay enforcement active. No new route escalation.';notes('containOutput',[`Volatility pressure: ${p}`,`Containment mode: ${mode}`,msg]);}
function runSync(){const pairs=[['timingSync','timingSyncInput'],['riskSync','riskSyncInput'],['replaySync','replaySyncInput'],['routeSync','routeSyncInput']];let total=0;pairs.forEach(([o,i])=>{const v=Number(qs('#'+i).value);qs('#'+o).textContent=v;total+=v;});const score=Math.round(total/4);let msg='Synchronization stable.';if(score>=88)msg='High synchronization quality.';if(score<70)msg='Synchronization weak. Send to replay before route.';notes('syncOutput',[`Synchronization score: ${score}`,msg,'Live broker execution remains disabled.']);}
function runGate(){const req=qs('#executionRequest').value,safety=qs('#systemSafety').value;let d='APPROVED FOR PAPER WATCH — confirmation required.';if(req==='Send to Paper Queue')d='SENT TO PAPER QUEUE.';if(req==='Replay Before Route')d='DIVERTED TO REPLAY BEFORE ROUTE.';if(req==='Block Route')d='BLOCKED BY EXECUTION GATE.';if(safety==='Elevated Risk')d='LIMITED — stronger confirmation required.';if(safety==='Volatility Defense')d='BLOCKED — volatility defense active.';if(safety==='Replay Only')d='BLOCKED — replay-only mode active.';notes('gateOutput',[`Execution request: ${req}`,`System safety: ${safety}`,`Decision: ${d}`,'Real-money execution remains disabled.']);}
function renderReplay(){const items=getStore('x26_replay'),el=qs('#replayLog');if(el)el.innerHTML=items.length?items.map(x=>`<div class="logitem">${x}</div>`).join(''):'<div class="logitem">No replay entries yet.</div>';}
function renderJournal(){const items=getStore('x26_journal'),el=qs('#journalLog');if(el)el.innerHTML=items.length?items.map(x=>`<div class="logitem">${x}</div>`).join(''):'<div class="logitem">No journal entries yet.</div>';}
function saveReplay(){const note=qs('#replayNote').value.trim(),result=qs('#replayResult').value;if(!note){alert('Type a replay note first.');return;}const items=getStore('x26_replay');items.unshift(`${result}: ${note} — ${new Date().toLocaleString()}`);setStore('x26_replay',items);qs('#replayNote').value='';renderReplay();}
function saveJournal(){const ticker=(qs('#journalTicker').value||'TICKER').toUpperCase(),setup=qs('#journalSetup').value,note=qs('#journalNote').value.trim();if(!note){alert('Type a journal note first.');return;}const items=getStore('x26_journal');items.unshift(`${ticker} • ${setup}: ${note} — ${new Date().toLocaleString()}`);setStore('x26_journal',items);qs('#journalTicker').value='';qs('#journalNote').value='';renderJournal();}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('load',()=>{
  // Load EmailJS
  const ejsScript=document.createElement('script');
  ejsScript.src='https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
  ejsScript.onload=()=>emailjs.init(EMAILJS_PUBLIC);
  document.head.appendChild(ejsScript);

  buildTradeView();
  loadAccountData();
  qsa('.nav').forEach(n=>n.addEventListener('click',()=>showView(n.dataset.view)));
  loadFeed();runConfidence();runRoute();runContain();runSync();runGate();renderReplay();renderJournal();
  qs('#runConfidence')?.addEventListener('click',runConfidence);qs('#confidenceRange')?.addEventListener('input',runConfidence);
  qs('#runRoute')?.addEventListener('click',runRoute);qs('#routeType')?.addEventListener('change',runRoute);qs('#routeConfidence')?.addEventListener('input',runRoute);
  qs('#runContain')?.addEventListener('click',runContain);qs('#volPressure')?.addEventListener('input',runContain);qs('#containMode')?.addEventListener('change',runContain);
  qs('#runSync')?.addEventListener('click',runSync);['timingSyncInput','riskSyncInput','replaySyncInput','routeSyncInput'].forEach(id=>qs('#'+id)?.addEventListener('input',runSync));
  qs('#runGate')?.addEventListener('click',runGate);qs('#executionRequest')?.addEventListener('change',runGate);qs('#systemSafety')?.addEventListener('change',runGate);
  qs('#saveReplay')?.addEventListener('click',saveReplay);qs('#clearReplay')?.addEventListener('click',()=>{localStorage.removeItem('x26_replay');renderReplay();});
  qs('#saveJournal')?.addEventListener('click',saveJournal);
});
