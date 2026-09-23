
/* =========================================================
   LEDGER — READY-TO-RUN VERSION
   Twelve Data API key supplied by user.
   ========================================================= */

const DEFAULT_API_KEY = "20fde0ec1c53457cb82e4f88d361d9ea";
const TWELVE_BASE = "https://api.twelvedata.com";

const DEFAULT_ASSETS = [
  {source:"stocks",id:"AAPL",symbol:"AAPL",name:"Apple Inc."},
  {source:"stocks",id:"MSFT",symbol:"MSFT",name:"Microsoft"},
  {source:"stocks",id:"NVDA",symbol:"NVDA",name:"NVIDIA"},
  {source:"stocks",id:"TSLA",symbol:"TSLA",name:"Tesla"},
  {source:"stocks",id:"AMZN",symbol:"AMZN",name:"Amazon"},
  {source:"stocks",id:"GOOGL",symbol:"GOOGL",name:"Alphabet"},
  {source:"stocks",id:"SPY",symbol:"SPY",name:"S&P 500 ETF"},
  {source:"stocks",id:"QQQ",symbol:"QQQ",name:"Nasdaq-100 ETF"},
  {source:"stocks",id:"XAU/USD",symbol:"XAU/USD",name:"Gold / USD"},
  {source:"stocks",id:"BRAP4",symbol:"BRAP4",name:"Bradespar PN",exchange:"BVMF",currency:"BRL"},
  {source:"stocks",id:"PETR4",symbol:"PETR4",name:"Petrobras PN",exchange:"BVMF",currency:"BRL"},
  {source:"stocks",id:"VALE3",symbol:"VALE3",name:"Vale ON",exchange:"BVMF",currency:"BRL"},
  {source:"stocks",id:"ITUB4",symbol:"ITUB4",name:"Itaú Unibanco PN",exchange:"BVMF",currency:"BRL"}
];

const DEFAULT_PLAN = `# Trading Plan

## Risk Management
- Risk only a defined percentage of capital per trade.
- Always define stop loss before entering.
- Avoid revenge trading and over-leverage.

## Entry
- Trade only setups that match the strategy.
- Confirm direction, liquidity and market context.
- Record the thesis before execution.

## Exit
- Respect the predefined stop loss.
- Use take profit or a trailing rule according to the setup.
- Review every closed trade.

## Review
- Journal every position.
- Review winners and losers weekly.
- Track execution quality, not only P/L.`;

let assets = loadJSON("ledger_assets", DEFAULT_ASSETS);
let journal = loadJSON("ledger_journal", []);
let plan = localStorage.getItem("ledger_plan") || DEFAULT_PLAN;
let currentFilter = "all";
let activeChart = null;
let activeSymbol = null;
let marketCache = {};

function loadJSON(key, fallback){
  try { const v=JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch(e){ return fallback; }
}
function saveState(){
  localStorage.setItem("ledger_assets",JSON.stringify(assets));
  localStorage.setItem("ledger_journal",JSON.stringify(journal));
  localStorage.setItem("ledger_plan",plan);
}
function apiKey(){
  return localStorage.getItem("twelvedata_api_key") || DEFAULT_API_KEY;
}
function esc(v){
  return String(v ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
function fmt(v,d=2){
  if(v===null||v===undefined||Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
}
function money(v,currency="USD"){
  if(v===null||v===undefined||Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString(currency==="BRL"?"pt-BR":"en-US",{style:"currency",currency:currency==="BRL"?"BRL":"USD",minimumFractionDigits:2,maximumFractionDigits:2});
}
function assetMeta(symbol){
  const a=assets.find(x=>x.symbol===symbol);
  const q=marketCache[symbol];
  const p=(typeof positions!=="undefined")?positions.find(x=>x.symbol===symbol):null;
  const exchange=a?.exchange||p?.exchange||q?.exchange||"";
  return {exchange,currency:a?.currency||p?.currency||q?.currency||(exchange==="BVMF"?"BRL":"USD")};
}
function setStatus(text,type="ok"){
  const s=document.getElementById("save-status");
  s.textContent=text;s.className=type;
}
function apiStatus(text,error=false){
  const el=document.getElementById("api-status");
  el.textContent=text;
  el.className="status-box "+(error?"error":"success");
}

/* ---------- Navigation ---------- */
document.querySelectorAll(".nav-item").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-"+btn.dataset.view).classList.add("active");
    if(btn.dataset.view==="settings") renderFavorites();
    if(btn.dataset.view==="journal") renderJournal();
    if(btn.dataset.view==="plan") renderPlan();
  });
});

/* ---------- Twelve Data ---------- */
/* The free Twelve Data plan allows only 8 API credits per rolling minute
   (and 800/day). This template's dashboard used to fire one request per
   watchlist symbol *in parallel* (plus another parallel batch for each
   sparkline), which blows through that limit instantly and comes back as
   "Error" for most rows. tdReserve() below queues every Twelve Data call
   so at most 8 go out per rolling 60s window, regardless of how many are
   kicked off at once. Calls now succeed, they just queue briefly instead
   of failing when the watchlist is larger than the per-minute allowance. */
const TD_CREDITS_PER_MIN = 8;
let tdCreditLog = [];
function tdWait(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function tdReserve(weight=1){
  for(;;){
    const now=Date.now();
    tdCreditLog=tdCreditLog.filter(t=>now-t<60000);
    if(tdCreditLog.length+weight<=TD_CREDITS_PER_MIN){
      for(let i=0;i<weight;i++) tdCreditLog.push(now);
      return;
    }
    const oldest=tdCreditLog[0];
    await tdWait(Math.max(60000-(now-oldest)+250,300));
  }
}

async function twelve(path,params={}){
  await tdReserve(1);
  const u=new URL(TWELVE_BASE+path);
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")u.searchParams.set(k,v)});
  u.searchParams.set("apikey",apiKey());
  const r=await fetch(u.toString());
  if(!r.ok) throw new Error("HTTP "+r.status);
  const data=await r.json();
  if(data.status==="error" || data.code){
    let msg=data.message || "Twelve Data request failed";
    if(/run out of api credits|limit/i.test(msg)) msg+=" — the built-in demo key is shared by everyone using this app and is likely rate-limited. Add your own free key in Settings.";
    throw new Error(msg);
  }
  return data;
}

/* Short-lived cache so switching tabs (which re-triggers loadDashboard)
   doesn't immediately re-fire a fresh burst of requests for data we
   already have. */
const QUOTE_TTL_MS=25000, DAILY_TTL_MS=10*60*1000;
let quoteCacheTime={}, dailyCache={};

async function getQuote(symbol,exchange="",{fresh=false}={}){
  const cacheKey=symbol+"|"+exchange;
  const cached=marketCache[symbol];
  if(!fresh && cached && quoteCacheTime[cacheKey] && Date.now()-quoteCacheTime[cacheKey]<QUOTE_TTL_MS){
    return cached;
  }
  const data=await twelve("/quote",{symbol,exchange});
  const price=Number(data.close ?? data.price ?? data.previous_close);
  if(!Number.isFinite(price)) throw new Error("No quote returned");
  const q={
    symbol:data.symbol||symbol,
    price,
    open:Number(data.open)||0,
    high:Number(data.high)||0,
    low:Number(data.low)||0,
    previous:Number(data.previous_close)||0,
    change:Number(data.change)||0,
    changePercent:Number(data.percent_change)||0,
    volume:Number(data.volume)||0,
    datetime:data.datetime||""
  };
  quoteCacheTime[cacheKey]=Date.now();
  return q;
}

async function getDaily(symbol,outputsize,exchange=""){
  const cacheKey=symbol+"|"+exchange+"|"+outputsize;
  const cached=dailyCache[cacheKey];
  if(cached && Date.now()-cached.t<DAILY_TTL_MS) return cached.data;
  const data=await twelve("/time_series",{symbol,interval:"1day",outputsize,exchange});
  dailyCache[cacheKey]={data,t:Date.now()};
  return data;
}

/* ---------- brapi.dev (Brazilian B3 stocks) ----------
   Twelve Data's free plan only covers US market data; BVMF/B3 needs their
   paid Grow plan. brapi.dev is free for Brazilian tickers instead, via its
   documented legacy endpoint GET /api/quote/{ticker}?range=&interval=,
   which returns both the live quote and historicalDataPrice in one call.
   PETR4, MGLU3, VALE3 and ITUB4 work with no token at all; any other B3
   ticker needs a free token from brapi.dev/dashboard (mixing a free ticker
   with any other symbol in the same request also requires a token). */
const BRAPI_BASE="https://brapi.dev/api/quote";
function brapiKey(){ return localStorage.getItem("brapi_api_key") || ""; }
async function brapiFetch(ticker,params={}){
  const u=new URL(BRAPI_BASE+"/"+encodeURIComponent(ticker));
  Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=="")u.searchParams.set(k,v)});
  const key=brapiKey();
  if(key) u.searchParams.set("token",key);
  const r=await fetch(u.toString());
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    throw new Error((data&&data.message)||("HTTP "+r.status+" from brapi.dev — this ticker may need a free token in Settings."));
  }
  const row=data.results&&data.results[0];
  if(!row) throw new Error("No data returned from brapi.dev for "+ticker);
  return row;
}
async function getQuoteBVMF(symbol){
  const row=await brapiFetch(symbol);
  const price=Number(row.regularMarketPrice);
  if(!Number.isFinite(price)) throw new Error("No quote returned from brapi.dev — this ticker may need a free token in Settings.");
  return {
    symbol:row.symbol||symbol,
    price,
    open:Number(row.regularMarketOpen)||0,
    high:Number(row.regularMarketDayHigh)||0,
    low:Number(row.regularMarketDayLow)||0,
    previous:Number(row.regularMarketPreviousClose)||0,
    change:Number(row.regularMarketChange)||0,
    changePercent:Number(row.regularMarketChangePercent)||0,
    volume:Number(row.regularMarketVolume)||0,
    datetime:row.regularMarketTime||""
  };
}
async function getDailyBVMF(symbol,range,interval){
  const row=await brapiFetch(symbol,{range,interval});
  const points=row.historicalDataPrice||[];
  return points.map(p=>({datetime:new Date(p.date*1000).toISOString(),close:p.close}));
}

async function loadDashboard(){
  const list=document.getElementById("asset-list");
  const watchlistStocks=assets.filter(a=>a.source==="stocks");
  const positionAssets=(typeof positions!=="undefined"?positions:[]).filter(p=>p.symbol&&!watchlistStocks.some(a=>a.symbol===p.symbol))
    .map(p=>({source:"stocks",id:p.symbol,symbol:p.symbol,name:p.name||p.symbol,exchange:p.exchange,currency:p.currency}));
  const stocks=[...watchlistStocks,...positionAssets];
  if(!stocks.length){
    list.innerHTML='<div class="empty-state">No Twelve Data assets. Add one in Settings.</div>';
    return;
  }
  list.innerHTML='<div class="empty-state">Loading stock market data...</div>';
  apiStatus(stocks.length>TD_CREDITS_PER_MIN?`Connecting to Twelve Data + brapi.dev — ${stocks.length} symbols queued, free plan allows ${TD_CREDITS_PER_MIN}/min so this may take a bit...`:"Connecting to Twelve Data + brapi.dev...");
  let successes=0;
  const results=await Promise.all(stocks.map(async a=>{
    try{
      const q=a.exchange==="BVMF" ? await getQuoteBVMF(a.symbol) : await getQuote(a.symbol,a.exchange||"");
      q.exchange=a.exchange||"";
      q.currency=a.currency||(a.exchange==="BVMF"?"BRL":"USD");
      marketCache[a.symbol]=q;
      successes++;
      return {asset:a,q};
    }catch(e){ return {asset:a,error:e.message}; }
  }));
  list.innerHTML="";
  results.filter(({asset})=>watchlistStocks.some(a=>a.symbol===asset.symbol)).forEach(({asset,q,error})=>{
    const row=document.createElement("div");
    row.className="asset-row";
    const badge=asset.exchange?`<span class="market-badge">${esc(asset.exchange)}</span>`:"";
    if(error){
      row.innerHTML=`<div class="asset-id"><div class="asset-symbol-line"><span class="asset-symbol">${esc(asset.symbol)}</span>${badge}</div><div class="asset-name">${esc(asset.name)}</div></div>
      <div class="asset-price">Unavailable</div><div class="asset-change neg">Error</div><div class="subtle">${esc(error)}</div><div class="asset-actions"><button class="btn small" onclick="openStockChart('${esc(asset.symbol)}')">Chart</button></div>`;
    }else{
      const positive=q.changePercent>=0;
      row.innerHTML=`<div class="asset-id"><div class="asset-symbol-line"><span class="asset-symbol">${esc(asset.symbol)}</span>${badge}</div><div class="asset-name">${esc(asset.name)}</div></div>
      <div class="asset-price num">${money(q.price,q.currency)}</div><div class="asset-change ${positive?"pos":"neg"}">${positive?"+":""}${fmt(q.changePercent)}%</div>
      <div class="asset-spark"><canvas id="spark-${cssSafe(asset.symbol)}"></canvas></div>
      <div class="asset-actions"><button class="btn small" onclick="openStockChart('${esc(asset.symbol)}')">Chart</button></div>`;
    }
    list.appendChild(row);
    if(q) drawSpark(asset.symbol);
  });
  const updated=document.getElementById("last-updated");
  updated.textContent="Updated "+new Date().toLocaleTimeString();
  if(successes===stocks.length) apiStatus(`Connected — ${successes}/${stocks.length} symbols loaded (${watchlistStocks.length} on watchlist). Global via Twelve Data, B3 via brapi.dev.`);
  else if(successes) apiStatus(`Connected — ${successes}/${stocks.length} symbols loaded so far, rest are queued or failed. Rerun "Refresh prices" in a minute if some are still missing.`);
  else{
    const firstError=results.find(r=>r.error)?.error||"";
    const rateLimited=/run out of api credits|limit/i.test(firstError);
    apiStatus(rateLimited?`Could not load market data — free API plan limit reached. ${firstError}`:"Could not load market data. Check the API key, symbol names, internet connection, or API limits.",true);
  }
}

async function drawSpark(symbol){
  try{
    const meta=assetMeta(symbol);
    let values;
    if(meta.exchange==="BVMF"){
      values=(await getDailyBVMF(symbol,"1mo","1d")).map(x=>Number(x.close)).filter(Number.isFinite);
    }else{
      const data=await getDaily(symbol,20);
      values=[...(data.values||[])].reverse().map(x=>Number(x.close)).filter(Number.isFinite);
    }
    const canvas=document.getElementById("spark-"+cssSafe(symbol));
    if(!canvas||values.length<2)return;
    new Chart(canvas,{type:"line",data:{labels:values.map((_,i)=>i),datasets:[{data:values,borderWidth:1.5,pointRadius:0,tension:.25,fill:false}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}}}});
  }catch(e){}
}
function cssSafe(s){return String(s).replace(/[^a-zA-Z0-9_-]/g,"_");}

/* ---------- Charts ---------- */
window.openStockChart=async function(symbol){
  activeSymbol=symbol;
  document.getElementById("chart-modal").hidden=false;
  document.getElementById("chart-title").textContent=symbol+" — Market Chart";
  document.getElementById("chart-price-now").textContent="Loading...";
  await loadChart(30);
};
async function loadChart(days){
  const note=document.getElementById("chart-note");
  try{
    const meta=assetMeta(activeSymbol);
    let values;
    if(meta.exchange==="BVMF"){
      const rangeMap={1:"5d",7:"1mo",30:"3mo",365:"1y"};
      values=await getDailyBVMF(activeSymbol,rangeMap[days]||"3mo","1d");
    }else{
      const output=days===1?2:(days===7?10:(days===30?35:270));
      const data=await getDaily(activeSymbol,output,meta.exchange);
      values=[...(data.values||[])].reverse();
    }
    if(!values.length)throw new Error("No historical data returned.");
    const prices=values.map(v=>Number(v.close));
    document.getElementById("chart-price-now").textContent=money(prices[prices.length-1],assetMeta(activeSymbol).currency);
    note.textContent=`${activeSymbol} · ${assetMeta(activeSymbol).exchange||"Global"} · ${assetMeta(activeSymbol).currency} · Daily data · ${values.length} points`;
    if(activeChart)activeChart.destroy();
    activeChart=new Chart(document.getElementById("price-chart"),{
      type:"line",data:{labels:values.map(v=>v.datetime),datasets:[{label:activeSymbol,data:prices,borderWidth:2,pointRadius:0,tension:.25,fill:false}]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{display:false}},
      scales:{x:{type:"time",time:{unit:days<=7?"day":"week"},ticks:{color:"#8B97A6"},grid:{color:"#262F3A"}},y:{ticks:{color:"#8B97A6",callback:v=>money(v,assetMeta(activeSymbol).currency)},grid:{color:"#262F3A"}}}}
    });
  }catch(e){
    document.getElementById("chart-price-now").textContent="Unavailable";
    note.textContent=e.message;
  }
}
document.querySelectorAll(".range-btn").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".range-btn").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");loadChart(Number(b.dataset.days));
}));
document.getElementById("chart-close").onclick=()=>document.getElementById("chart-modal").hidden=true;
document.getElementById("chart-modal").addEventListener("click",e=>{if(e.target===e.currentTarget)e.currentTarget.hidden=true});

/* ---------- Settings ---------- */
function renderFavorites(){
  const box=document.getElementById("fav-list");box.innerHTML="";
  assets.forEach((a,i)=>{
    const div=document.createElement("div");div.className="fav-item";
    const exch=a.exchange?` · ${esc(a.exchange)} · ${esc(a.currency||"")}`:"";
    div.innerHTML=`<div><b>${esc(a.symbol)}</b><div class="subtle">${esc(a.name)} · ${esc(a.source)}${exch}</div></div><button class="btn small danger" onclick="removeAsset(${i})">Remove</button>`;
    box.appendChild(div);
  });
}
window.removeAsset=i=>{assets.splice(i,1);saveState();renderFavorites();loadDashboard();};

document.getElementById("fav-source").addEventListener("change",e=>{
  const stocks=e.target.value==="stocks";
  document.getElementById("fav-id").placeholder=stocks?"Symbol (e.g. AAPL)":"CoinGecko id (e.g. bitcoin)";
  document.getElementById("fav-symbol").placeholder=stocks?"Symbol (e.g. AAPL)":"Symbol (e.g. BTC)";
  document.getElementById("fav-name").placeholder=stocks?"Display name (e.g. Apple)":"Display name (e.g. Bitcoin)";
  document.getElementById("fav-exchange").style.display=stocks?"":"none";
});
document.getElementById("fav-form").addEventListener("submit",e=>{
  e.preventDefault();
  const source=document.getElementById("fav-source").value;
  const id=document.getElementById("fav-id").value.trim();
  const symbol=document.getElementById("fav-symbol").value.trim().toUpperCase();
  const name=document.getElementById("fav-name").value.trim();
  const exchange=source==="stocks"?document.getElementById("fav-exchange").value:"";
  const currency=exchange==="BVMF"?"BRL":"USD";
  if(!id||!symbol||!name)return;
  assets.push({source,id,symbol,name,exchange,currency});saveState();e.target.reset();renderFavorites();loadDashboard();
});
document.getElementById("twelvedata-key").value=apiKey(); document.getElementById("fav-exchange").style.display="";
document.getElementById("save-key-btn").onclick=()=>{
  const key=document.getElementById("twelvedata-key").value.trim();
  if(!key)return;
  localStorage.setItem("twelvedata_api_key",key);
  document.getElementById("key-status").textContent="API key saved in this browser.";
  loadDashboard();
};
document.getElementById("test-key-btn").onclick=async()=>{
  const el=document.getElementById("key-status");el.textContent="Testing...";
  try{const q=await getQuote("AAPL");el.textContent=`Connection OK — AAPL $${fmt(q.price)}.`;el.className="success";}
  catch(e){el.textContent="Connection failed: "+e.message;el.className="error";}
};
document.getElementById("brapi-key").value=brapiKey();
document.getElementById("save-brapi-key-btn").onclick=()=>{
  const key=document.getElementById("brapi-key").value.trim();
  localStorage.setItem("brapi_api_key",key);
  document.getElementById("brapi-key-status").textContent=key?"Token saved in this browser.":"Token cleared — using free tier (PETR4, VALE3, MGLU3, ITUB4 only).";
  loadDashboard();
};
document.getElementById("test-brapi-key-btn").onclick=async()=>{
  const el=document.getElementById("brapi-key-status");el.textContent="Testing...";
  try{const q=await getQuoteBVMF("PETR4");el.textContent=`Connection OK — PETR4 R$${fmt(q.price)}.`;el.className="success";}
  catch(e){el.textContent="Connection failed: "+e.message;el.className="error";}
};

/* ---------- Plan ---------- */
function renderPlan(){
  const out=document.getElementById("plan-render");
  const lines=plan.split(/\r?\n/);let html="";
  for(const line of lines){
    if(line.startsWith("# "))html+=`<h2>${esc(line.slice(2))}</h2>`;
    else if(line.startsWith("## "))html+=`<h3>${esc(line.slice(3))}</h3>`;
    else if(line.startsWith("- "))html+=`<li>${esc(line.slice(2))}</li>`;
    else if(line.trim())html+=`<p>${esc(line)}</p>`;
  }
  out.innerHTML=html;
}
document.getElementById("plan-edit-btn").onclick=()=>{
  document.getElementById("plan-editor").value=plan;
  document.getElementById("plan-editor").hidden=false;
  document.getElementById("plan-render").hidden=true;
  document.getElementById("plan-edit-btn").hidden=true;
  document.getElementById("plan-save-btn").hidden=false;
};
document.getElementById("plan-save-btn").onclick=()=>{
  plan=document.getElementById("plan-editor").value;
  saveState();renderPlan();
  document.getElementById("plan-editor").hidden=true;document.getElementById("plan-render").hidden=false;
  document.getElementById("plan-edit-btn").hidden=false;document.getElementById("plan-save-btn").hidden=true;
};

/* ---------- Journal ---------- */
function renderJournal(){
  const box=document.getElementById("journal-list");
  const rows=journal.filter(x=>currentFilter==="all"||(currentFilter==="open"?x.status==="open":x.type===currentFilter));
  if(!rows.length){box.innerHTML='<div class="empty-state">No journal entries yet.</div>';return;}
  box.innerHTML=rows.map(x=>{
    const pl=calcPL(x), pc=pl>=0?"pos":"neg";
    return `<div class="entry-card"><div class="entry-top"><div class="entry-left"><span class="tag ${esc(x.type)}">${esc(x.type)}</span><span class="tag ${esc(x.direction)}">${esc(x.direction)}</span><span class="tag ${esc(x.status)}">${esc(x.status)}</span><span class="entry-asset">${esc(x.asset)}</span></div><div class="entry-pl ${pc}">${x.status==="closed"?fmt(pl):"Open"}</div></div>
    <div class="entry-meta"><div><span>Entry</span>${esc(x.entryDate||"—")}</div><div><span>Entry price</span>${fmt(x.entryPrice)}</div><div><span>Exit price</span>${fmt(x.exitPrice)}</div><div><span>Size</span>${fmt(x.size,4)}</div><div><span>R:R</span>${esc(x.rr||"—")}</div></div>
    ${x.notes?`<div class="entry-notes">${esc(x.notes)}</div>`:""}<div class="entry-actions"><button class="btn small" onclick="editEntry('${esc(x.id)}')">Edit</button><button class="btn small danger" onclick="deleteEntry('${esc(x.id)}')">Delete</button></div></div>`;
  }).join("");
}
function calcPL(x){
  if(x.status!=="closed"||x.exitPrice===""||x.exitPrice==null)return 0;
  const diff=Number(x.exitPrice)-Number(x.entryPrice),size=Number(x.size)||1;
  return (x.direction==="short"?-diff:diff)*size;
}
document.querySelectorAll(".filter-chip").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".filter-chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");currentFilter=b.dataset.filter;renderJournal();
});
function openEntry(x={}){
  document.getElementById("entry-modal").hidden=false;
  document.getElementById("entry-modal-title").textContent=x.id?"Edit journal entry":"New journal entry";
  const fields={id:"entry-id",type:"entry-type",direction:"entry-direction",asset:"entry-asset",status:"entry-status",entryDate:"entry-entrydate",entryPrice:"entry-entryprice",exitDate:"entry-exitdate",exitPrice:"entry-exitprice",size:"entry-size",rr:"entry-rr",stop:"entry-stop",target:"entry-target",notes:"entry-notes"};
  Object.entries(fields).forEach(([k,id])=>document.getElementById(id).value=x[k]??"");
}
document.getElementById("new-entry-btn").onclick=()=>openEntry();
document.getElementById("entry-close").onclick=()=>document.getElementById("entry-modal").hidden=true;
document.getElementById("entry-cancel").onclick=()=>document.getElementById("entry-modal").hidden=true;
document.getElementById("entry-form").onsubmit=e=>{
  e.preventDefault();
  const g=id=>document.getElementById(id).value;
  const x={id:g("entry-id")||crypto.randomUUID(),type:g("entry-type"),direction:g("entry-direction"),asset:g("entry-asset").toUpperCase(),status:g("entry-status"),entryDate:g("entry-entrydate"),entryPrice:g("entry-entryprice"),exitDate:g("entry-exitdate"),exitPrice:g("entry-exitprice"),size:g("entry-size"),rr:g("entry-rr"),stop:g("entry-stop"),target:g("entry-target"),notes:g("entry-notes")};
  const i=journal.findIndex(j=>j.id===x.id);if(i>=0)journal[i]=x;else journal.unshift(x);
  saveState();document.getElementById("entry-modal").hidden=true;renderJournal();
};
window.editEntry=id=>{const x=journal.find(j=>j.id===id);if(x)openEntry(x)};
window.deleteEntry=id=>{if(confirm("Delete this journal entry?")){journal=journal.filter(j=>j.id!==id);saveState();renderJournal()}};

/* ---------- Import / Export ---------- */
document.getElementById("export-btn").onclick=()=>{
  const data={version:1,exportedAt:new Date().toISOString(),assets,journal,plan,positions};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="ledger-data.json";a.click();URL.revokeObjectURL(a.href);
};
document.getElementById("import-btn").onclick=()=>document.getElementById("import-input").click();
document.getElementById("import-input").onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{const data=JSON.parse(await file.text());if(Array.isArray(data.assets))assets=data.assets;if(Array.isArray(data.journal))journal=data.journal;if(typeof data.plan==="string")plan=data.plan;if(Array.isArray(data.positions)){positions=data.positions;savePositions();}saveState();renderFavorites();renderJournal();renderPlan();renderPortfolio();loadDashboard();setStatus("Imported successfully","ok");}
  catch(err){alert("Invalid Ledger JSON file.");}
};
document.getElementById("reset-btn").onclick=()=>{
  if(confirm("Reset watchlist, plan and journal to demo data?")){
    assets=DEFAULT_ASSETS.map(x=>({...x}));journal=[];plan=DEFAULT_PLAN;saveState();renderFavorites();renderPlan();renderJournal();loadDashboard();
  }
};

/* ---------- Refresh / Clock ---------- */
document.getElementById("refresh-btn").onclick=async()=>{
  const b=document.getElementById("refresh-btn");b.disabled=true;b.textContent="Refreshing...";
  try{await loadDashboard();setStatus("Market data refreshed","ok")}finally{b.disabled=false;b.textContent="Refresh prices"}
};
function clock(){
  document.getElementById("clock").textContent=new Date().toLocaleString();
}
setInterval(clock,1000);clock();


/* ---------- Portfolio ---------- */
let positions=loadJSON("ledger_positions",[]);

function savePositions(){localStorage.setItem("ledger_positions",JSON.stringify(positions));}

function renderPortfolio(){
  const box=document.getElementById("portfolio-list");
  const summary=document.getElementById("portfolio-summary");
  if(!positions.length){
    summary.innerHTML="No positions yet. Add a stock, ETF or other Twelve Data symbol.";
    box.innerHTML='<div class="empty-state">Your portfolio is empty.<br><button class="btn primary" onclick="openPosition()">Add your first position</button></div>';
    return;
  }
  let totalCost=0,totalValue=0,totalProfit=0;
  const rows=positions.map((p,i)=>{
    const q=marketCache[p.symbol];
    const current=q?.price ?? null;
    const avg=Number(p.average)||0, shares=Number(p.shares)||0;
    const cost=avg*shares, value=current==null?null:current*shares;
    const profit=value==null?null:value-cost;
    const pct=cost?((current-avg)/avg)*100:null;
    totalCost+=cost;if(value!=null){totalValue+=value;totalProfit+=profit;}
    return {p,i,current,cost,value,profit,pct};
  });
  summary.innerHTML=`<div class="portfolio-kpis">
    <div class="kpi"><div class="kpi-label">Invested cost</div><div class="kpi-value">${money(totalCost,positions.length?assetMeta(positions[0].symbol).currency:"USD")}</div></div>
    <div class="kpi"><div class="kpi-label">Current value</div><div class="kpi-value">${money(totalValue,positions.length?assetMeta(positions[0].symbol).currency:"USD")}</div></div>
    <div class="kpi"><div class="kpi-label">Unrealized P/L</div><div class="kpi-value ${totalProfit>=0?"return-pos":"return-neg"}">${money(totalProfit,positions.length?assetMeta(positions[0].symbol).currency:"USD")}</div></div>
    <div class="kpi"><div class="kpi-label">Portfolio return</div><div class="kpi-value ${totalCost&&totalProfit>=0?"return-pos":"return-neg"}">${totalCost?fmt(totalProfit/totalCost*100):"—"}%</div></div>
  </div>`;
  box.innerHTML=`<div class="position-row"><b>Asset</b><b>Avg. price</b><b>Current</b><b>Shares</b><b>Return</b><b></b></div>`+
    rows.map(r=>{
      const cls=r.pct==null?"":r.pct>=0?"return-pos":"return-neg";
      return `<div class="position-row"><div class="position-symbol">${esc(r.p.symbol)}<span class="position-muted">${esc(r.p.name)}</span></div>
      <div class="num">${money(r.p.average,assetMeta(r.p.symbol).currency)}</div><div class="num">${r.current==null?"—":money(r.current,assetMeta(r.p.symbol).currency)}</div><div class="num">${fmt(r.p.shares,4)}</div>
      <div class="num ${cls}">${r.pct==null?"—":(r.pct>=0?"+":"")+fmt(r.pct)+"%"}</div>
      <div class="position-actions"><button class="btn small" onclick="editPosition(${r.i})">Edit</button> <button class="btn small danger" onclick="deletePosition(${r.i})">Delete</button></div></div>`;
    }).join("");
}
function openPosition(p={}){
  document.getElementById("position-modal").hidden=false;
  document.getElementById("position-modal-title").textContent=p.id?"Edit portfolio position":"Add portfolio position";
  document.getElementById("position-id").value=p.id||"";
  document.getElementById("position-symbol").value=p.symbol||"";
  document.getElementById("position-name").value=p.name||"";
  document.getElementById("position-exchange").value=p.exchange||"";
  document.getElementById("position-average").value=p.average??"";
  document.getElementById("position-shares").value=p.shares??"";
  document.getElementById("position-notes").value=p.notes||"";
}
window.editPosition=i=>openPosition(positions[i]);
window.deletePosition=i=>{if(confirm("Delete this position?")){positions.splice(i,1);savePositions();renderPortfolio();}};
document.getElementById("new-position-btn").onclick=()=>openPosition();
document.getElementById("position-close").onclick=()=>document.getElementById("position-modal").hidden=true;
document.getElementById("position-cancel").onclick=()=>document.getElementById("position-modal").hidden=true;
document.getElementById("position-form").onsubmit=async e=>{
  e.preventDefault();
  const g=id=>document.getElementById(id).value;
  const symbol=g("position-symbol").trim().toUpperCase();
  const exchange=g("position-exchange");
  const currency=exchange==="BVMF"?"BRL":(assetMeta(symbol).currency||"USD");
  const p={id:g("position-id")||crypto.randomUUID(),symbol,name:g("position-name").trim(),average:Number(g("position-average")),shares:Number(g("position-shares")),notes:g("position-notes"),exchange,currency};
  const idx=positions.findIndex(x=>x.id===p.id);if(idx>=0)positions[idx]=p;else positions.push(p);
  savePositions();document.getElementById("position-modal").hidden=true;renderPortfolio();loadDashboard();
};

/* ---------- Analytics ---------- */
let analyticsCharts={};
function destroyAnalytics(){Object.values(analyticsCharts).forEach(c=>{try{c.destroy()}catch(e){}});analyticsCharts={};}
function renderPortfolioAllocationChart(){
  const canvas=document.getElementById("portfolio-alloc-chart");
  if(!canvas)return;
  if(!positions.length){
    const ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);
    return;
  }
  const rows=positions.map(p=>{
    const q=marketCache[p.symbol];
    const current=(q?.price??Number(p.average))||0;
    const shares=Number(p.shares)||0;
    return {label:p.symbol,value:current*shares};
  }).filter(r=>r.value>0);
  if(!rows.length)return;
  const palette=["#C9A961","#3FB68B","#7AA2F7","#E0645A","#B98FD1","#4FC3D9","#E0A458","#8FBF7F","#D97BA6","#6E90C4"];
  analyticsCharts.alloc=new Chart(canvas,{type:"doughnut",data:{labels:rows.map(r=>r.label),datasets:[{data:rows.map(r=>r.value),backgroundColor:rows.map((_,i)=>palette[i%palette.length]),borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{color:"#8B97A6",boxWidth:12,font:{size:11}}},tooltip:{callbacks:{label:ctx=>{const total=rows.reduce((s,r)=>s+r.value,0);const pct=total?(ctx.parsed/total*100).toFixed(1):"0.0";return ` ${ctx.label}: ${money(ctx.parsed,positions[0]?assetMeta(positions[0].symbol).currency:"USD")} (${pct}%)`;}}}}}});
}
function renderAnalytics(){
  destroyAnalytics();
  renderPortfolioAllocationChart();
  const closed=journal.filter(x=>x.status==="closed"&&Number.isFinite(Number(x.entryPrice))&&Number.isFinite(Number(x.exitPrice)));
  const summary=document.getElementById("analytics-summary");
  if(!closed.length){summary.textContent="No closed journal trades yet. Close some trades in Journal to generate analytics.";return;}
  const ordered=[...closed].sort((a,b)=>new Date(a.exitDate||a.entryDate||0)-new Date(b.exitDate||b.entryDate||0));
  const pls=ordered.map(x=>calcPL(x));const wins=pls.filter(x=>x>0).length;const losses=pls.filter(x=>x<0).length;
  const total=pls.reduce((a,b)=>a+b,0),avg=total/pls.length,winRate=wins/pls.length*100;
  let running=0;const cumulative=pls.map((v,i)=>{running+=v;return {i:i+1,value:running};});
  summary.innerHTML=`<b>${closed.length}</b> closed trades · <b class="${total>=0?"return-pos":"return-neg"}">$${fmt(total)}</b> total P/L · <b>${fmt(winRate)}%</b> win rate · <b>$${fmt(avg)}</b> average P/L`;
  analyticsCharts.pl=new Chart(document.getElementById("pl-chart"),{type:"bar",data:{labels:ordered.map((x,i)=>x.asset+" #"+(i+1)),datasets:[{label:"P/L",data:pls,borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>"$"+fmt(v)}}}}});
  analyticsCharts.cum=new Chart(document.getElementById("cumulative-chart"),{type:"line",data:{labels:cumulative.map(x=>x.i),datasets:[{label:"Cumulative P/L",data:cumulative.map(x=>x.value),borderWidth:2,pointRadius:2,tension:.2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>"$"+fmt(v)}}}}});
  analyticsCharts.win=new Chart(document.getElementById("winloss-chart"),{type:"doughnut",data:{labels:["Winning trades","Losing trades","Break-even"],datasets:[{data:[wins,losses,pls.filter(x=>x===0).length],borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false}});
  const types=["day","swing","holding"];analyticsCharts.type=new Chart(document.getElementById("type-chart"),{type:"bar",data:{labels:types.map(x=>x[0].toUpperCase()+x.slice(1)),datasets:[{label:"P/L",data:types.map(t=>closed.filter(x=>x.type===t).reduce((s,x)=>s+calcPL(x),0)),borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>"$"+fmt(v)}}}}});
}
document.getElementById("refresh-analytics-btn").onclick=renderAnalytics;

/* ---------- Navigation additions ---------- */
document.querySelectorAll(".nav-item").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if(btn.dataset.view==="portfolio"){renderPortfolio();loadDashboard().then(renderPortfolio);}
    if(btn.dataset.view==="analytics"){renderAnalytics();loadDashboard().then(renderAnalytics);}
  });
});

/* ---------- Keep portfolio values fresh ---------- */
const originalLoadDashboard=loadDashboard;
loadDashboard=async function(){
  await originalLoadDashboard();
  if(document.getElementById("view-portfolio").classList.contains("active"))renderPortfolio();
};

/* ---------- Start ---------- */
renderPlan();
renderJournal();
renderFavorites();
loadDashboard();
