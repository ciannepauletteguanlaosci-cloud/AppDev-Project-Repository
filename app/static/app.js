'use strict';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',minimumFractionDigits:2}).format((v||0)/100);
const short=v=>v>=100000?'₱'+(v/100000).toFixed(1)+'k':money(v);
const today=()=>{let d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const icons={grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',wallet:'M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V6 M16 12h5v5h-5z',swap:'M4 7h16m-4-4 4 4-4 4 M20 17H4m4-4-4 4 4 4',bucket:'M4 7h16l-2 14H6z M8 7V5a4 4 0 0 1 8 0v2',users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',plus:'M12 5v14 M5 12h14',down:'M12 3v14m-5-5 5 5 5-5 M4 20h16',up:'M12 21V7m-5 5 5-5 5 5 M4 3h16',calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',logout:'M9 3H3v18h6 M10 12h11m-4-4 4 4-4 4',help:'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',food:'M4 3v7c0 3 6 3 6 0V3 M7 3v18 M20 3c-4 0-5 9 0 9v9 M20 3v9',travel:'m2 13 8 1 3 8 2-9 7-9-9 7z',laptop:'M4 3h16v13H4z M2 20h20l-2-4H4z',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z m-4 10 3 3 5-6',chart:'M3 3v18h18 M7 14l4-5 4 3 6-8',close:'m6 6 12 12 M6 18 18 6',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',edit:'m16 3 5 5-12 12-6 1 1-6z M14 5l5 5',bank:'m3 8 9-6 9 6z M5 10v9 M10 10v9 M14 10v9 M19 10v9 M2 22h20',check:'m5 12 4 4L19 6',search:'M21 21l-6-6 M17 9a8 8 0 1 1-16 0 8 8 0 0 1 16 0'};
const icon=(name)=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.wallet}"/></svg>`;
const brand=()=>'<div class="brand"><span class="brandmark">p</span>penny<span style="margin-left:-7px">wais<em>.</em></span></div>';
const categories=['Food','Transport','Shopping','Rent','Utilities','Subscriptions','Education','Travel','Health','Savings','Allowance','Freelance','Shared expenses','Shared settlements','Other'];
const catIcon=c=>({Food:'food',Transport:'travel',Travel:'travel',Education:'laptop',Savings:'shield',Rent:'bank'}[c]||'wallet');
const options=(items,selected)=>items.map(x=>`<option ${x===selected?'selected':''}>${esc(x)}</option>`).join('');
let state=null,page='dashboard',selectedGroup=null,authMode='login',toastTimer,authNotice='';
const newAIState=()=>({question:'',answer:'',error:'',loading:false,includeSummary:false,summaryIncluded:false,truncated:false});
let aiUI=newAIState();
async function api(path,method='GET',body){const r=await fetch('/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});let d;try{d=await r.json();}catch{throw Error('The server is unavailable. Please try again.');}if(!r.ok){if(r.status===401&&state){state=null;authMode='login';renderAuth();}throw Error(Array.isArray(d.detail)?d.detail.map(x=>x.msg.replace('Value error, ','')).join(' '):d.detail||'Something went wrong.');}return d;}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
async function refresh(){state=await api('state');render();}
function nav(p){page=p;selectedGroup=null;location.hash=p;render();window.scrollTo(0,0);}
function monthTx(){return state.transactions.filter(t=>t.date.startsWith(today().slice(0,7)));}
function sum(t,kind){return t.filter(x=>x.kind===kind).reduce((a,x)=>a+x.amount,0);}
function totals(){return monthTx().filter(t=>t.kind==='expense').reduce((a,t)=>(a[t.category]=(a[t.category]||0)+t.amount,a),{});}
function empty(title,text,button=''){return `<div class="empty">${icon('wallet')}<h3>${title}</h3><p>${text}</p>${button}</div>`;}
function btn(label,action,style='',ico=''){return `<button class="btn ${style}" data-action="${action}">${ico?icon(ico):''}${label}</button>`;}
function head(title,desc,buttons=''){return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div><div class="actions">${buttons}</div></div>`;}
function passwordField(id,label,autocomplete='current-password'){
  return `<label for="${id}">${label}</label><div class="password-field"><input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" minlength="8" maxlength="128" required placeholder="At least 8 characters"><button class="password-toggle" type="button" data-password-toggle="${id}" aria-controls="${id}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">Show</button></div>`;
}
let recoveryEmail='';
function renderAuth(){
  const dialog=$('#modal');if(dialog?.open)dialog.close();if(dialog)dialog.innerHTML='';
  aiUI=newAIState();const reg=authMode==='register',reset=authMode==='reset',forgot=authMode==='forgot',recovering=reset||forgot;
  $('#app').innerHTML=`<main class="auth"><section class="auth-art">${brand()}<div class="auth-copy"><div class="eyebrow">A little wiser, every day</div><h1 style="margin-top:20px">Big dreams.<br>Small steps.<br><span>Smarter money.</span></h1><p>A little intention goes a long way. Make room for the things that matter with Penny Wais.</p><div class="orbit"><div class="coin">₱</div></div></div><div class="auth-footer">Made for your everyday. Built for your tomorrow.</div></section><section class="auth-main"><form id="auth-form" class="auth-form"><div class="eyebrow muted">YOUR MONEY, WITH INTENTION</div>
  <h2>${forgot?'Forgot your password?':reset?'Choose a new password.':reg?'Your next chapter starts here.':'Good to have you back.'}</h2>
  <p class="muted">${forgot?'Enter your account email to request a reset code.':reset?'Enter the code from your email and choose a new password. Your records stay saved.':reg?'Sign up once. Your account and records stay saved.':'Already registered? Sign in with the same email and password.'}</p>
  ${authNotice?`<p class="auth-success" role="status">${esc(authNotice)}</p>`:''}
  ${reg?'<label for="name">Your name</label><input id="name" name="name" autocomplete="given-name" maxlength="60" required placeholder="What should we call you?">':''}
  <label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required placeholder="you@example.com" value="${recovering?esc(recoveryEmail):''}">
  ${reset?'<label for="code">Reset code</label><input id="code" name="code" autocomplete="one-time-code" inputmode="numeric" autocapitalize="none" spellcheck="false" maxlength="128" required placeholder="Enter your reset code"><p class="sub">Codes expire after 15 minutes and can be used once.</p>':''}
  ${forgot?'':passwordField('password',reset?'New password':'Password',reg||reset?'new-password':'current-password')}
  ${reset?passwordField('confirm_password','Confirm new password','new-password'):forgot?'':`<label class="remember-me" for="remember-me"><input id="remember-me" name="remember_me" type="checkbox"><span>Remember me for 30 days</span></label><p class="muted login-help">Use this on your own device. You can sign out anytime.</p>`}
  ${!reg&&!recovering?'<button class="text-btn forgot-password" type="button" data-action="auth-forgot">Forgot password?</button>':''}
  <p class="form-error" role="alert"></p><button class="btn primary" type="submit">${forgot?'Send reset code':reset?'Reset password':reg?'Create my account':'Sign in'}</button>
  ${forgot?'<button class="text-btn" type="button" data-action="auth-reset">I already have a code</button>':reset?'<button class="text-btn" type="button" data-action="auth-forgot">Request another code</button>':''}
  <div class="auth-toggle">${recovering?'<button type="button" data-action="auth-login">Back to sign in</button>':`${reg?'Already have an account?':'New to Penny Wais?'} <button type="button" data-action="auth-toggle">${reg?'Sign in':'Create an account'}</button>`}</div>
  <p class="privacy-note">Your name, email, and financial entries are stored in this installation to provide your budget and summaries. Passwords are hashed. No bank credentials are collected. This is a local development app.</p></form></section></main>`;
  $('#auth-form').onsubmit=async e=>{
    e.preventDefault();const form=e.target,b=form.querySelector('[type=submit]');b.disabled=true;form.querySelector('.form-error').textContent='';
    try{
      const credentials=Object.fromEntries(new FormData(form));
      if(forgot){
        const result=await api('password/forgot','POST',{email:credentials.email});
        if(authMode!=='forgot'||$('#auth-form')!==form)return;
        recoveryEmail=credentials.email;authMode='reset';authNotice=result.message;renderAuth();
      }else if(reset){
        if(credentials.password!==credentials.confirm_password)throw Error('The passwords do not match.');
        await api('password/reset','POST',credentials);
        if(authMode!=='reset'||$('#auth-form')!==form)return;
        state=null;recoveryEmail='';authMode='login';authNotice='Password updated. Sign in with your new password.';renderAuth();
      }else{
        credentials.remember_me=form.querySelector('#remember-me').checked;
        await api(reg?'register':'login','POST',credentials);authNotice='';await refresh();
      }
    }catch(err){form.querySelector('.form-error').textContent=err.message;}finally{b.disabled=false;}
  };
}

function render(){if(!state)return renderAuth();const navs=[['dashboard','grid','Overview'],['transactions','swap','Transactions'],['buckets','bucket','Wallet buckets'],['shared','users','Shared budgets'],['insights','spark','Insights'],['budgets','chart','Monthly budgets'],['accounts','wallet','My accounts'],['connections','bank','Bank connections']];if(state.user.role==='admin')navs.push(['admin','shield','Admin']);const titles=Object.fromEntries(navs.map(x=>[x[0],x[2]]));$('#app').innerHTML=`<aside class="sidebar">${brand()}<div class="navlabel">YOUR WORKSPACE</div><nav class="nav" aria-label="Main navigation">${navs.map(([p,i,n])=>`<button data-nav="${p}" class="${page===p?'active':''}" ${page===p?'aria-current="page"':''}>${icon(i)}<span>${n}</span></button>`).join('')}</nav><div class="sidebar-bottom"><div class="mini-promo">${icon('spark')}<h3 style="font-size:14px;margin-top:10px">Small habits. Big futures.</h3><p>Every peso has a purpose.<br>Let’s find yours.</p><button class="text-btn" data-nav="help">Explore your guide</button></div><div class="profile"><span class="avatar">${esc(state.user.name[0].toUpperCase())}</span><div class="profile-text"><strong>${esc(state.user.name)}</strong><small>Personal account</small></div><button title="Sign out" aria-label="Sign out" data-action="logout">${icon('logout')}</button></div></div></aside><div class="shell"><header class="topbar"><div class="breadcrumb">My workspace <strong>/ &nbsp;${titles[page]||'Your guide'}</strong></div><div class="mobile-brand">${brand()}</div><div class="top-right"><span class="date-chip">${icon('calendar')}${new Date().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</span><button class="icon-btn" aria-label="Help and account" data-nav="help">${icon('help')}</button><span class="avatar">${esc(state.user.name[0].toUpperCase())}</span></div></header><main class="workspace">${content()}<footer class="page-footer"><span>© ${new Date().getFullYear()} Penny Wais. Every peso, a purpose.</span><span>Made for a wiser you.</span></footer></main></div>`;if(page==='transactions')bindFilters();if(page==='admin')loadAdmin();if(page==='insights')bindAI();if(page==='connections')loadConnections();if(page==='dashboard')loadBankOverview();if(page==='help')loadMyConcerns();}
function content(){switch(page){case'transactions':return transactions();case'buckets':return buckets();case'budgets':return budgets();case'shared':return shared();case'insights':return aiPanel()+insights();case'accounts':return accountsPage();case'connections':return connections();case'help':return help();case'admin':return head('Administration','Manage account access and reported concerns.')+'<div id="admin-content" class="card">Loading…</div>';default:return dashboard();}}
function dashboard(){const tx=monthTx(),income=sum(tx,'income'),expense=sum(tx,'expense');return head(`A little wiser, ${state.user.name.split(' ')[0]}.`,'Here’s how your money is doing. Let’s make every peso count.',btn('Scan receipt','scan-receipt','','spark')+btn('Add transaction','transaction','primary','plus'))+`<div class="wallet-summary" id="wallet-balance">${walletBalanceContent()}</div><div class="stats activity-stats"><section class="stat"><div class="stat-top">Income this month ${icon('down')}</div><div class="amount">${money(income)}</div><div class="stat-bottom"><span class="tag">Money in</span> Your monthly inflow</div></section><section class="stat"><div class="stat-top">Expenses this month ${icon('up')}</div><div class="amount">${money(expense)}</div><div class="stat-bottom"><span class="tag" style="background:#f8efe6;color:#ab7748">Money out</span> ${income?Math.round(expense/income*100)+'% of income':'No income recorded'}</div></section></div>${accountOverview()}${bankOverview()}${!state.transactions.length?`<div class="notice">Welcome to your fresh start. Add your first income to begin, or explore with sample records. <button class="text-btn" data-action="demo">Load sample data</button></div>`:''}<div class="main-grid"><div class="stack"><section class="card"><div class="card-head"><div><h2>Your money in motion</h2><p class="sub">Income and expenses · last 6 months</p></div><div class="legend"><span><i class="dot"></i>Income</span><span><i class="dot expense"></i>Expenses</span></div></div>${chart()}<div class="chart-footer">${icon('chart')}A clearer picture of where you’ve been, and where you’re going.</div></section><section class="card"><div class="card-head"><div><h2>A purpose for every peso</h2><p class="sub">Your wallet buckets</p></div><button class="text-btn" data-nav="buckets">View all</button></div>${bucketCards(3)}</section><section class="card"><div class="card-head"><div><h2>Recent activity</h2><p class="sub">The little things add up</p></div><button class="text-btn" data-nav="transactions">View all</button></div>${transactionTable(state.transactions.slice(0,4))}</section></div><div class="stack"><section class="card insight">${insightCard()}</section><section class="card"><div class="card-head"><div><h2>Where it’s going</h2><p class="sub">Your spending this month</p></div></div>${donut()}</section><section class="card"><div class="card-head"><div><h2>Keep your plans on track</h2><p class="sub">Monthly category budgets</p></div></div>${budgetRows(3)}<button class="text-btn" data-nav="budgets" style="margin-top:12px">Manage budgets</button></section></div></div>`;}
function chart(){let months=[];for(let i=5;i>=0;i--){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,tx=state.transactions.filter(t=>t.date.startsWith(key));months.push({label:d.toLocaleDateString('en',{month:'short'}),income:sum(tx,'income'),expense:sum(tx,'expense')});}const max=Math.max(...months.flatMap(m=>[m.income,m.expense]),10000);return `<div class="chart" role="img" aria-label="Monthly income and expense comparison"><div class="axis">${[1,.75,.5,.25,0].map(x=>`<span>${x?short(max*x):'₱0'}</span>`).join('')}</div><div class="bars">${months.map(m=>`<div class="bar-group"><div class="bar-pair"><div class="bar" style="height:${m.income/max*100}%" title="${m.label} income: ${money(m.income)}"></div><div class="bar light" style="height:${m.expense/max*100}%" title="${m.label} expenses: ${money(m.expense)}"></div></div><div class="bar-label">${m.label}</div></div>`).join('')}</div></div>`;}
function donut(){const ts=Object.entries(totals()).sort((a,b)=>b[1]-a[1]);if(!ts.length)return empty('A fresh canvas','Your expense categories will appear here.');let top=ts.slice(0,4);if(ts.length>4)top.push(['Other',ts.slice(4).reduce((a,x)=>a+x[1],0)]);const colors=['#255c40','#68934e','#a6c37e','#d4e4b3','#edeed5'],total=top.reduce((a,x)=>a+x[1],0);let start=0;const gradient=top.map((x,i)=>{const end=start+x[1]/total*100,r=`${colors[i]} ${start}% ${end}%`;start=end;return r;}).join(',');return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${gradient})" role="img" aria-label="Total monthly spending ${money(total)}"><div class="donut-center"><strong>${short(total)}</strong><small>Total spent</small></div></div><div class="category-legend">${top.map(([k,v],i)=>`<div><span><i class="dot" style="background:${colors[i]}"></i>${esc(k)}</span><b>${Math.round(v/total*100)}%</b></div>`).join('')}</div></div>`;}
function insightCard(){const f=state.forecast;const over=f.ready?f.categories.find(x=>x.budget&&x.projected>x.budget):null;return `<div class="insight-label"><span class="eyebrow">Your Penny perspective</span><span class="sparkle">${icon('spark')}</span></div><h2>${!f.ready?'Your next chapter starts with a little clarity.':over?`A little check-in on ${esc(over.category.toLowerCase())}.`:'A little foresight goes a long way.'}</h2><p>${!f.ready?'Start recording your daily spending. We’ll turn those little details into a clearer picture of what’s ahead.':over?`At your current pace, ${esc(over.category.toLowerCase())} could reach ${money(over.projected)} over 30 days, above your ${money(over.budget)} budget.`:`Your next 30 days of spending are estimated at ${money(f.projected)}, based on your recent records.`}</p><button class="btn small" data-nav="insights">Explore my insights ${icon('spark')}</button>`;}
function bucketCards(limit){const rows=limit?state.buckets.slice(0,limit):state.buckets;if(!rows.length)return empty('Give your money a purpose','Save for something special, or a little peace of mind.',btn('Create a bucket','bucket','small','plus'));return `<div class="bucket-grid">${rows.map(b=>`<article class="bucket"><span class="bucket-icon">${icon(catIcon(b.category))}</span><h3>${esc(b.name)}</h3><div class="money">${money(b.amount)}</div><div class="sub">of ${money(b.target)} goal</div><div class="progress"><span style="width:${Math.min(100,b.amount/b.target*100)}%"></span></div><div class="bucket-bottom"><span>${Math.round(b.amount/b.target*100)}% saved</span><button data-edit-bucket="${b.id}">Manage</button></div></article>`).join('')}</div>`;}
function transactionTable(rows,full=false){if(!rows.length)return empty('No transactions yet','Record income or an expense to see it here.');return `<div class="table-wrap"><table><thead><tr><th>Transaction</th><th class="hide-mobile">Category</th><th class="hide-mobile">Date</th><th>Amount</th>${full?'<th></th>':''}</tr></thead><tbody>${rows.map(t=>`<tr><td><div class="transaction-name"><span class="category-icon">${icon(t.kind==='income'?'down':catIcon(t.category))}</span><div>${esc(t.description)}<small>${t.kind==='income'?'Income':'Expense'}${full?' · '+esc(t.date):''}${t.account_id?' · '+esc((state.wallet_accounts||[]).find(a=>a.id===t.account_id)?.name||'Account'):''}</small></div></div></td><td class="hide-mobile"><span class="pill">${esc(t.category)}</span></td><td class="hide-mobile sub">${new Date(t.date+'T12:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</td><td class="money ${t.kind==='income'?'positive':'negative'}">${t.kind==='income'?'+':'−'}${money(t.amount)}</td>${full?`<td>${t.source?`<span class="pill">${t.source==='receipt'?'Receipt':t.source==='account_opening'?'Starting balance':'Shared record'}</span>`:`<button title="Delete transaction" aria-label="Delete ${esc(t.description)}" data-delete="transactions/${t.id}">${icon('trash')}</button>`}</td>`:''}</tr>`).join('')}</tbody></table></div>`;}
function transactions(){return head('Every little detail.','Your income and expenses, all in one place.',btn('Scan receipt','scan-receipt','','spark')+btn('Export CSV','export','','down')+btn('Add transaction','transaction','primary','plus'))+`<section class="card"><div class="filters"><input id="search" aria-label="Search transactions" placeholder="Search your transactions…"><select id="kind-filter" aria-label="Transaction type">${options(['All types','Income','Expense'])}</select><select id="category-filter" aria-label="Category">${options(['All categories',...categories])}</select></div><div id="transaction-results">${transactionTable(state.transactions,true)}</div></section>`;}
function bindFilters(){for(const id of ['search','kind-filter','category-filter'])$('#'+id).addEventListener('input',()=>{const q=$('#search').value.toLowerCase(),k=$('#kind-filter').value,c=$('#category-filter').value;$('#transaction-results').innerHTML=transactionTable(state.transactions.filter(t=>(t.description.toLowerCase().includes(q)||t.category.toLowerCase().includes(q))&&(k==='All types'||t.kind===k.toLowerCase())&&(c==='All categories'||t.category===c)),true);});}
function buckets(){return head('A purpose for every peso.','Separate your everyday money from your someday dreams.',btn('New bucket','bucket','primary','plus'))+`<div class="notice">${money(state.unallocated)} available to allocate · ${money(state.balance-state.unallocated)} set aside in buckets. Release funds from a bucket before spending them.</div>`+bucketCards();}
function budgetRows(limit){let rows=limit?state.budgets.slice(0,limit):state.budgets,spent=totals();if(!rows.length)return empty('Make a little plan','Set a monthly limit for each spending category.',btn('Set a budget','budget','small','plus'));return rows.map(b=>{let s=spent[b.category]||0,p=s/b.amount*100;return `<div class="budget-row"><div class="budget-top"><h3 style="font-size:14px">${esc(b.category)}</h3><small>${money(s)} / ${money(b.amount)}</small></div><div class="progress ${p>85?'warn':''}"><span style="width:${Math.min(p,100)}%"></span></div><div class="budget-top"><small>${p>100?money(s-b.amount)+' over budget':money(b.amount-s)+' left this month'}</small>${!limit?`<div><button data-edit-budget="${b.id}" aria-label="Edit ${esc(b.category)} budget">${icon('edit')}</button><button data-delete="budgets/${b.id}" aria-label="Delete ${esc(b.category)} budget">${icon('trash')}</button></div>`:''}</div></div>`;}).join('');}
function budgets(){return head('A plan you can grow with.','Monthly limits help you spend with a little more intention.',btn('Set a budget','budget','primary','plus'))+`<section class="card">${budgetRows()}</section>`;}
function insights(){const f=state.forecast;return head('A clearer view of tomorrow.','A spending forecast built from your recent financial records.')+(!f.ready?`<section class="card">${empty('A little more history, a lot more clarity',esc(f.message),btn('Add transaction','transaction','primary','plus'))}</section>`:`<div class="main-grid"><section class="card insight"><div class="eyebrow">Next 30 days · estimated expenses</div><div class="large-number">${money(f.projected)}</div><p>${esc(f.method)}</p><p style="margin-top:15px">Based on ${f.days} days of recent history. Irregular purchases and recurring bills can change the result.</p></section><section class="card"><h2>Build a better rhythm</h2><p class="muted" style="margin-top:15px">${f.recurring.length?'Frequently recorded: '+f.recurring.map(esc).join(', ')+'. Review whether these repeat purchases still fit your priorities.':'Keep recording your expenses to spot repeated purchases over time.'}</p></section><section class="card span-all"><div class="card-head"><h2>Your category outlook</h2><button class="text-btn" data-nav="budgets">Adjust budgets</button></div>${f.categories.map(c=>`<div class="balance-row"><div><strong>${esc(c.category)}</strong><p class="sub">${!c.budget?'Set a budget to compare your forecast.':c.projected>c.budget?`Projected ${money(c.projected-c.budget)} above budget. Review discretionary spending in this category.`:'Your current pace is within the monthly limit.'}</p></div><div><strong class="money">${money(c.projected)}</strong><p class="sub">${c.budget?'Budget '+money(c.budget):'Next 30 days'}</p></div></div>`).join('')}</section></div>`);}
function aiPanel(){return `<section class="card ai-panel" aria-labelledby="ai-title">
  <div class="card-head"><div><div class="eyebrow">POWERED BY GEMINI</div><h2 id="ai-title">Your budgeting assistant</h2></div>${icon('spark')}</div>
  <p class="muted">Ask about saving, planning your spending, or using Penny Wais.</p>
  <form id="ai-form">
    <label for="ai-question">Your question</label>
    <textarea id="ai-question" name="question" required maxlength="2000" rows="3" placeholder="How can I start building an emergency fund?" ${aiUI.loading?'disabled':''}>${esc(aiUI.question)}</textarea>
    <div class="ai-suggestions" aria-label="Example questions"><button type="button" class="btn small" data-ai-question="How do I add available money in Penny Wais?" ${aiUI.loading?'disabled':''}>Add available money</button><button type="button" class="btn small" data-ai-question="How can I plan my spending this month?" ${aiUI.loading?'disabled':''}>Plan my spending</button></div>
    <label class="ai-consent" for="ai-summary"><input id="ai-summary" type="checkbox" ${aiUI.includeSummary?'checked':''} ${aiUI.loading?'disabled':''}><span>Include my balance, reserved funds, this month's category totals and budget limits</span></label>
    <p class="sub">Sending shares your question with Google Gemini. Your budget summary is shared only when selected. Account details and transaction descriptions are not added automatically. Each question is answered separately.</p>
    <div class="ai-actions"><button class="btn primary" type="submit" ${aiUI.loading?'disabled':''}>${aiUI.loading?'Thinking…':'Ask AI'}</button></div>
  </form>
  <p class="form-error" role="alert">${esc(aiUI.error)}</p>
  <div aria-live="polite" aria-busy="${aiUI.loading}">${aiUI.loading?'<p class="sub">Gemini is preparing your answer…</p>':''}${aiUI.answer?`<div class="ai-answer"><strong>Gemini's answer</strong><p class="sub">${aiUI.summaryIncluded?'Used your budget summary':'Answered without your budget summary'}</p><div class="ai-answer-text">${esc(aiUI.answer)}</div>${aiUI.truncated?'<p class="sub">This answer reached the length limit. Try asking a more specific question.</p>':''}</div>`:''}</div>
  <p class="sub ai-footnote">AI can make mistakes. Check amounts before making decisions. The assistant cannot move money or change your records.</p>
</section>`;}
function bindAI(){
  const form=$('#ai-form');if(!form)return;
  form.querySelector('#ai-question').addEventListener('input',e=>{aiUI.question=e.target.value;});
  form.querySelector('#ai-summary').addEventListener('change',e=>{aiUI.includeSummary=e.target.checked;});
  form.querySelectorAll('[data-ai-question]').forEach(button=>button.addEventListener('click',()=>{aiUI.question=button.dataset.aiQuestion;$('#ai-question').value=aiUI.question;$('#ai-question').focus();}));
  form.onsubmit=async e=>{
    e.preventDefault();if(aiUI.loading)return;
    const requestUI=aiUI;requestUI.question=$('#ai-question').value.trim();
    if(!requestUI.question){$('#ai-question').focus();return;}
    requestUI.includeSummary=$('#ai-summary').checked;requestUI.loading=true;requestUI.error='';requestUI.answer='';render();
    try{
      const result=await api('ai/ask','POST',{question:requestUI.question,include_summary:requestUI.includeSummary});
      if(aiUI!==requestUI)return;
      requestUI.answer=result.answer;requestUI.summaryIncluded=result.summary_included;requestUI.truncated=result.truncated;
    }catch(err){if(aiUI===requestUI)requestUI.error=err.message;}
    finally{requestUI.loading=false;if(aiUI===requestUI&&state&&page==='insights')render();}
  };
}
function shared(){const g=state.groups.find(g=>g.id===selectedGroup);if(g)return groupDetail(g);return head('Better, together.','Split the costs. Keep the good company.',btn('Join with a code','join')+btn('Create group','group','primary','plus'))+(state.groups.length?`<div class="group-list">${state.groups.map(g=>`<button class="card" style="text-align:left" data-group="${g.id}"><div class="group-top"><span class="bucket-icon">${icon('users')}</span><div><h2>${esc(g.name)}</h2><p class="sub">${g.members.length} ${g.members.length===1?'member':'members'} · ${g.expenses.length} expenses</p></div></div><p class="muted">${esc(g.description||'A little teamwork for your shared expenses.')}</p><div class="members">${g.members.map(m=>`<span class="avatar" title="${esc(m.name)}">${esc(m.name[0])}</span>`).join('')}</div></button>`).join('')}</div>`:`<section class="card">${empty('Good company. Clear balances.','Create a group for your roommates, friends, or next adventure.',btn('Create a group','group','primary','users'))}</section>`);}
function groupDetail(g){const names=Object.fromEntries(g.members.map(m=>[m.id,m.name]));return `<button class="text-btn" data-nav="shared">All shared groups</button>`+head(g.name,g.description||'Shared expenses, a little simpler.',btn('Record payment','payment')+btn('Add shared expense','shared-expense','primary','plus'))+`<div class="notice">Recording a shared expense deducts the full amount from the payer’s wallet. Recording a payment deducts from the sender and adds to the receiver automatically. Record payments made outside Penny Wais only once. Earlier records marked “Before wallet sync” are unchanged.</div><div class="main-grid"><div class="stack"><section class="card"><h2>Group expenses</h2>${g.expenses.length?g.expenses.map(e=>`<div class="balance-row"><div><strong>${esc(e.description)}</strong><p class="sub">Paid by ${esc(names[e.payer])} · ${e.shares.length} participants</p><p class="sub">${e.shares.map(s=>esc(names[s.user_id])+': '+money(s.amount)).join(' · ')}</p><small class="muted">${e.wallet_posted?'Wallet updated':'Before wallet sync'}</small></div><strong class="money">${money(e.amount)}</strong></div>`).join(''):empty('No shared expenses yet','Add an expense you paid for the group.')}</section><section class="card"><h2>Recorded payments</h2>${g.payments.length?g.payments.map(p=>`<div class="balance-row"><div>${esc(names[p.sender])} paid ${esc(names[p.receiver])}<p class="sub">${p.wallet_posted?'Both wallets updated':'Before wallet sync'}</p></div><strong class="money">${money(p.amount)}</strong></div>`).join(''):'<p class="sub" style="margin-top:15px">No settlements recorded yet.</p>'}</section></div><div class="stack"><section class="card"><h2>Who owes what</h2>${g.members.map(m=>`<div class="balance-row"><span>${esc(m.name)}${m.id===state.user.id?' (you)':''}</span><div style="text-align:right"><strong class="${m.balance>0?'positive':''}">${money(Math.abs(m.balance))}</strong><p class="sub">${m.balance>0?'is owed':m.balance<0?'owes':'settled up'}</p></div></div>`).join('')}</section>${g.owner===state.user.id?`<section class="card"><h2>A seat at the table</h2><p class="sub" style="margin-top:12px">Share this private invite code with someone you want to join. They can accept it using “Join with a code”.</p><div class="invite-code">${esc(g.code)}</div><button class="text-btn" data-action="copy-invite">Copy invite code</button></section>`:''}</div></div>`;}
function connections(){return head('Your accounts, connected.','Connect a test account through Brankas.')+`
  <section class="card bank-panel"><span class="pill">Sandbox · test accounts only</span>
    <h2>Try account linking</h2>
    <p>Continue to Brankas to authorize a dummy bank account. Use only the test credentials supplied by Brankas. Penny Wais does not collect bank passwords or OTPs.</p>
    <div class="notice">This test integration cannot connect your real BPI, GCash, Maya, UnionBank or other accounts. Known PHP test balances are included in the total wallet balance, labeled as sandbox. Available budget funds come from recorded transactions.</div>
    <button class="btn primary" data-bank-action="link" id="bank-link" disabled>Link test account</button>
    <p id="bank-error" class="form-error" role="alert"></p>
    <p class="sub">After completing authorization, return here and select Check status. Account summaries are saved to your personal account. This retrieves a statement snapshot; it does not continuously sync your bank.</p>
  </section>
  <section class="card bank-panel"><div class="card-head"><h2>Your test connections</h2><button class="text-btn" data-bank-action="reload">Reload list</button></div><div id="bank-list" aria-live="polite">Loading connections…</div></section>`;}

const bankStatusLabels={starting:'Starting',pending:'Awaiting authorization / processing',linked:'Test account linked',no_accounts:'No accounts returned',failed:'Authorization failed',cancelled:'Cancelled',expired:'Expired'};
function walletBalanceContent(){
  const connected=state.connected_accounts||0, missing=state.missing_bank_balances||0, needsRefresh=state.bank_balances_need_refresh||0;
  return `<section class="stat hero"><div class="stat-top">Total wallet balance ${icon('wallet')}</div>
    <div class="amount">${money(state.wallet_total??state.balance)}</div>
    <div class="stat-bottom">${connected?'<span class="tag">Sandbox included</span> Combined balance':'Your recorded wallet balance'}</div>
  </section>
  <section class="stat"><div class="stat-top">Recorded money ${icon('bucket')}</div>
    <div class="amount">${money(state.balance)}</div>
    <div class="stat-bottom">${money(state.unallocated)} available for buckets</div>
  </section>
  <section class="stat sandbox-stat"><div class="stat-top">Sandbox accounts <span class="tag">Test money</span></div>
    <div class="amount">${connected?money(state.connected_balance):'—'}</div>
    <div class="stat-bottom">${connected?`${connected} account${connected===1?'':'s'} included in total`:'No balances included yet'}</div>
    <p class="wallet-note">Test balances are not spendable budget money.</p>
    ${missing?`<p class="wallet-note">${missing} account${missing===1?'':'s'} without a PHP balance excluded.</p>`:''}
    ${needsRefresh?'<p class="wallet-note">Check status in Bank connections to include older account snapshots.</p>':''}
  </section>`;
}
function bankOverview(){
  return `<section class="card bank-panel"><div class="card-head"><div><h2>Connected accounts</h2><p class="sub">Known PHP balances included in total wallet balance · sandbox</p></div><button class="text-btn" data-nav="connections">Manage connections</button></div><div id="bank-overview" aria-live="polite">Loading connected accounts…</div></section>`;
}
function bankOverviewContent(rows){
  if(!rows.length)return '<p>No test accounts linked yet. Open Bank connections to get started.</p>';
  return rows.map(row=>`<article class="bank-connection"><div class="card-head"><strong>Brankas sandbox</strong><span class="pill">${esc(bankStatusLabels[row.status]||'Unknown status')}</span></div>
    ${row.status==='linked'?row.accounts.map(a=>`<div class="connection"><div><strong>${esc(a.name)} ${a.last_four?'•••• '+esc(a.last_four):''}</strong><p>${a.transaction_count} test transactions in snapshot</p></div><strong class="bank-account-balance">${a.balance===null?'Balance unavailable':money(a.balance)}</strong></div>`).join(''):'<p>No account balance retrieved. Open Bank connections to complete authorization or check status.</p>'}
    ${row.status==='linked'&&row.checked?`<p class="sub">Last checked ${esc(new Date(row.checked*1000).toLocaleString())}. Each account is counted once using its newest linked snapshot. Test balances do not change available funds or spending charts.</p>`:''}
  </article>`).join('');
}
async function loadBankOverview(){
  const container=$('#bank-overview'), userId=state?.user.id;
  if(!container)return;
  try{
    const data=await api('bank-connections');
    if(page!=='dashboard'||state?.user.id!==userId||$('#bank-overview')!==container)return;
    if(data.wallet_summary){Object.assign(state,data.wallet_summary);const wallet=$('#wallet-balance');if(wallet)wallet.innerHTML=walletBalanceContent();}
    container.innerHTML=bankOverviewContent(data.connections);
  }catch(err){if($('#bank-overview')===container)container.textContent='Unable to load connected accounts. Open Bank connections to retry.';}
}
function bankCards(rows){
  if(!rows.length)return '<p>No test accounts linked yet.</p>';
  return rows.map(row=>`<article class="bank-connection">
    <div class="card-head"><strong>Brankas sandbox</strong><span class="pill">${esc(bankStatusLabels[row.status]||'Unknown status')}</span></div>
    <p class="sub">Started ${esc(new Date(row.created*1000).toLocaleString())}</p>
    ${row.accounts.map(a=>`<div class="connection"><div><strong>${esc(a.name)} ${a.last_four?'•••• '+esc(a.last_four):''}</strong><p>${a.transaction_count} test transactions in snapshot</p></div><strong>${a.balance===null?'Balance unavailable':money(a.balance)}</strong></div>`).join('')}
    ${['failed','cancelled','expired','no_accounts'].includes(row.status)?'<p>Remove this entry and start a new link to try again.</p>':''}
    <div class="bank-actions">${row.status==='pending'&&row.redirect_uri?`<a class="btn" href="${esc(row.redirect_uri)}" referrerpolicy="no-referrer">Continue at Brankas</a>`:''}
    ${['pending','linked','no_accounts'].includes(row.status)?`<button class="btn" data-bank-action="check" data-connection-id="${esc(row.id)}">Check status</button>`:''}
    <button class="text-btn" data-bank-action="remove" data-connection-id="${esc(row.id)}">Remove from app</button></div>
  </article>`).join('');
}

async function loadConnections(){
  const container=$('#bank-list'), userId=state?.user.id;
  if(!container)return;
  try{
    const data=await api('bank-connections');
    if(page!=='connections'||state?.user.id!==userId||$('#bank-list')!==container)return;
    container.innerHTML=bankCards(data.connections);
    $('#bank-link').disabled=!data.configured;
    $('#bank-error').textContent=data.message||'';
  }catch(err){if($('#bank-list')===container){container.textContent='Unable to load connections. Select Reload list to retry.';$('#bank-error').textContent=err.message;}}
}

async function bankAction(el){
  const action=el.dataset.bankAction, userId=state?.user.id;
  if(action==='remove'&&!confirm('Remove this connection and its saved summary from Penny Wais? This does not revoke consent or delete records held by Brankas.'))return;
  el.disabled=true;
  const error=$('#bank-error');
  if(error)error.textContent='';
  try{
    if(action==='link'){
      const result=await api('bank-connections','POST');
      if(state?.user.id===userId&&page==='connections')location.assign(result.redirect_uri);
    }else if(action==='check'){
      await api('bank-connections/'+encodeURIComponent(el.dataset.connectionId)+'/refresh','POST');
      await loadConnections();
    }else if(action==='remove'){
      await api('bank-connections/'+encodeURIComponent(el.dataset.connectionId),'DELETE');
      await loadConnections();
    }else await loadConnections();
  }catch(err){if(error&&$('#bank-error')===error)error.textContent=err.message;}
  finally{el.disabled=false;}
}
function help(){return head('A little guidance.','Everything you need to feel at home in Penny Wais.',btn('Sign out','logout'))+`<div class="help-grid"><section class="card"><h2>Start with what you have</h2><p>Add an income transaction for your current available balance. Then record expenses as you go. All amounts are in Philippine pesos.</p><button class="text-btn" data-action="transaction">Add a transaction</button><br><button class="text-btn" data-nav="accounts">My e-wallets and bank accounts</button></section><section class="card"><h2>Give your money a purpose</h2><p>Buckets set money aside from your available balance. To spend it, lower the bucket allocation first, then add an expense. Monthly budgets are spending limits, separate from your wallet allocations.</p><button class="text-btn" data-nav="budgets">Manage monthly budgets</button></section><section class="card"><h2>Keep your group in sync</h2><p>Create a shared group and give your invite code to your friends. Each person accepts using their own account. Record expenses you paid, choose participants, and split equally or enter custom amounts. Record a payment after you settle outside the app. New shared expenses deduct the full amount from the payer’s wallet; payments deduct from the sender and credit the receiver. These entries appear automatically in Transactions.</p><button class="text-btn" data-nav="shared">Open shared budgets</button></section><section class="card"><h2>A forecast, with context</h2><p>Record at least five expenses on three different days in the last 30 days. Insights use a daily-average projection. The forecast uses a statistical average. For budgeting questions, use the Gemini AI assistant in Insights. A prediction is an estimate that changes with your records.</p><button class="text-btn" data-nav="insights">Explore insights</button></section><section class="card"><h2>Your records and privacy</h2><p>This installation stores your account and financial records in a local database. Other users cannot access your personal records. Group members can see group records and names. You can delete manually added transactions and export your transaction history as CSV. Questions you send to the AI assistant go to Google Gemini, along with your budget summary only when you choose to include it.</p><button class="text-btn" data-action="export">Export transactions</button></section><section class="card"><h2>Need a hand?</h2><p>Send a concern to this installation’s administrator. Bank connections offers Brankas sandbox linking for test accounts. Real bank linking is not enabled. Record your real transactions manually.</p><button class="text-btn" data-action="concern">Report a concern</button><br><button class="text-btn" data-nav="connections">Bank connections</button>${state.user.role==='admin'?'<br><button class="text-btn" data-nav="admin">Administration</button>':''}<div id="my-concerns" aria-live="polite"><p class="sub">Loading your support requests…</p></div></section></div>`;}
function field(name,label,type='text',value='',extra=''){return `<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;}
function select(name,label,items,value){return `<label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options(items,value)}</select>`;}
function modal(title,fields,save,label='Save',danger=''){const d=$('#modal');d.innerHTML=`<div class="modal-head"><h2>${title}</h2><button data-action="close" type="button" aria-label="Close dialog">${icon('close')}</button></div><form id="modal-form">${fields}<p class="form-error" role="alert"></p><div class="form-actions">${danger}<button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">${label}</button></div></form>`;d.showModal();$('#modal-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{await save(Object.fromEntries(new FormData(e.target)),e.target);d.close();await refresh();toast('All saved. A little wiser already.');}catch(err){e.target.querySelector('.form-error').textContent=err.message;}finally{b.disabled=false;}};}
function cents(v){const s=String(v).trim();if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('Enter a positive amount with at most two decimal places.');const [whole,fraction='']=s.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('Amount is too large.');return n;}
function transactionModal(accountId=null){modal('A little update',`<p class="sub">${money(state.unallocated)} available to spend</p>${accountSelect('Account',accountId)}<div class="field-row"><div>${select('kind','Transaction type',['Expense','Income'])}</div><div>${field('amount','Amount (₱)','number','','required min="0.01" max="100000000" step="0.01"')}</div></div>${field('description','Description','text','','required maxlength="120" placeholder="What was it for?"')}<div class="field-row"><div>${select('category','Category',categories)}</div><div>${field('date','Date','date',today(),`required max="${today()}"`)}</div></div>`,d=>api('transactions','POST',{...d,account_id:d.account_id?Number(d.account_id):null,kind:d.kind.toLowerCase(),amount:cents(d.amount)}),'Add transaction');}
function bucketModal(id){const b=state.buckets.find(b=>b.id===id);modal(b?'Make room for your plans':'Give it a purpose',`<p class="sub">${money(state.unallocated+(b?.amount||0))} available for this bucket</p>${field('name','Bucket name','text',b?.name||'','required maxlength="60" placeholder="e.g. Rainy day fund"')}${select('category','Category',categories,b?.category||'Savings')}<div class="field-row"><div>${field('amount','Set aside (₱)','number',(b?.amount||0)/100,'required min="0" step="0.01"')}</div><div>${field('target','Goal (₱)','number',b?b.target/100:'','required min="0.01" step="0.01"')}</div></div>`,d=>api('buckets'+(b?'/'+id:''),b?'PUT':'POST',{...d,amount:cents(d.amount),target:cents(d.target)}),'Save bucket',b?`<button class="btn danger" type="button" data-delete="buckets/${id}">Delete</button>`:'');}
function budgetModal(id){const b=state.budgets.find(b=>b.id===id);modal('A little spending plan',select('category','Category',categories,b?.category)+field('amount','Monthly limit (₱)','number',b?b.amount/100:'','required min="0.01" step="0.01"')+'<p class="sub" style="margin-top:15px">Saving replaces the existing limit for the selected category.</p>',d=>api('budgets','POST',{...d,amount:cents(d.amount)}),'Set budget');}
// Keep one identifier for the lifetime of a form, including network retries.
function sharedRequestId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');}
function sharedExpenseModal(){
  const g=state.groups.find(g=>g.id===selectedGroup),request_id=sharedRequestId();
  modal('Something you paid for',`<p class="sub">${money(state.unallocated)} available. The full amount will be deducted from your wallet automatically. Add only expenses you have already paid and have not recorded in Transactions.</p>`+accountSelect('Paid from')+field('description','Description','text','','required maxlength="120"')+field('amount','Total paid (₱)','number','','required min="0.01" step="0.01"')+select('split','Split method',['Equally','Custom amounts'])+'<label>Participants and optional custom shares (₱)</label>'+g.members.map(m=>`<div class="check-row"><input id="member-${m.id}" type="checkbox" name="member-${m.id}" checked><label for="member-${m.id}">${esc(m.name)}</label><input class="share-input" aria-label="Custom share for ${esc(m.name)}" type="number" min="0" step="0.01" name="share-${m.id}" placeholder="Custom ₱"></div>`).join(''),d=>{
    const ids=g.members.filter(m=>d['member-'+m.id]).map(m=>m.id);
    return api(`groups/${g.id}/expenses`,'POST',{request_id,account_id:d.account_id?Number(d.account_id):null,description:d.description,amount:cents(d.amount),participants:ids,shares:d.split==='Custom amounts'?ids.map(id=>cents(d['share-'+id])):null});
  },'Record and update wallet');
}
function paymentModal(){
  const g=state.groups.find(g=>g.id===selectedGroup),creditors=g.members.filter(m=>m.balance>0&&m.id!==state.user.id),me=g.members.find(m=>m.id===state.user.id);
  if(!creditors.length||me.balance>=0)return toast('You have no outstanding debt in this group.');
  const request_id=sharedRequestId();
  modal('Record your payment',`<p class="sub">Record money you have already paid outside Penny Wais. This deducts from your wallet and credits the recipient’s wallet automatically. Do not add the same payment in Transactions.</p><p class="sub">Outstanding debt: ${money(-me.balance)} · Available money: ${money(state.unallocated)}</p><label for="f-receiver">Paid to</label><select name="receiver" id="f-receiver">${creditors.map(m=>`<option value="${m.id}">${esc(m.name)} · owed ${money(m.balance)}</option>`).join('')}</select>`+accountSelect('Paid from')+field('amount','Amount paid (₱)','number','','required min="0.01" step="0.01"'),d=>api(`groups/${g.id}/payments`,'POST',{request_id,account_id:d.account_id?Number(d.account_id):null,receiver:Number(d.receiver),amount:cents(d.amount)}),'Record and update wallets');
}
const accountProviders=['GCash','Maya','UnionBank','BPI','Metrobank','BDO','EastWest','RCBC','Security Bank','Other'];
function accountSelect(label='Account',selected=null,required=false){
  return `<label for="f-account_id">${label}</label><select id="f-account_id" name="account_id" ${required?'required':''}>${required?'<option value="">Choose an account</option>':`<option value="">Money without an account · ${money(state.unassigned_balance??state.balance)}</option>`}${(state.wallet_accounts||[]).map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${esc(a.name)}${a.name!==a.provider?' · '+esc(a.provider):''} · ${money(a.balance)}</option>`).join('')}</select>`;
}
function accountCards(){
  return (state.wallet_accounts||[]).map(a=>`<article class="account-card"><div class="card-head"><span class="account-mark">${icon(['GCash','Maya'].includes(a.provider)?'wallet':'bank')}</span><span class="pill">${esc(a.provider)}</span></div><h3>${esc(a.name)}</h3><strong class="account-amount">${money(a.balance)}</strong><p class="sub">Manually tracked balance</p><button class="text-btn" data-account-transaction="${a.id}">Add income or expense</button></article>`).join('');
}
function accountOverview(){
  return `<section class="card account-panel"><div class="card-head"><div><h2>My e-wallets & banks</h2><p class="sub">Your recorded account balances</p></div><button class="text-btn" data-nav="accounts">Manage accounts</button></div>${state.wallet_accounts?.length?`<div class="account-grid">${accountCards()}</div>`:'<p class="sub">Add GCash, Maya or your bank account, enter its balance, then scan receipts to track spending.</p>'}<div class="bank-actions">${btn('Add account','wallet-account','','plus')}${btn('Scan receipt','scan-receipt','','spark')}</div></section>`;
}
function accountsPage(){
  return head('Your money, by account.','Track your e-wallets and bank balances in one place.',btn('Scan receipt','scan-receipt','','spark')+btn('Add account','wallet-account','primary','plus'))+`<div class="notice">Enter the balance you have in each account. Receipt expenses update these records after you review and save them. Your actual bank or e-wallet balance is not changed by Penny Wais.</div><div class="account-grid">${accountCards()}<article class="account-card"><h3>Money without an account</h3><strong class="account-amount">${money(state.unassigned_balance??state.balance)}</strong><p class="sub">Earlier records and incoming shared payments. Assign existing money when adding an account.</p></article></div><section class="card receipt-guide"><h2>Receipt to expense</h2><p>1. Take a photo or choose a receipt.</p><p>2. Gemini suggests the total, date and category.</p><p>3. Review the details, choose the account you paid from, and save.</p><p class="sub">The selected account and total wallet balance update together. Income and expenses can also be added manually.</p></section>`;
}
function walletAccountModal(){
  const request_id=sharedRequestId();
  modal('Add an e-wallet or bank',select('provider','E-wallet or bank',accountProviders)+field('name','Nickname (optional)','text','','maxlength="60" placeholder="e.g. My GCash"')+field('amount','Current balance (₱)','number','','required min="0" max="100000000" step="0.01"')+`<label for="f-funding">Is this money already in your wallet total?</label><select id="f-funding" name="funding"><option value="new">No — add this balance to my wallet</option><option value="existing">Yes — assign my existing money</option></select><p class="sub">${money(state.unassigned_balance??state.balance)} can be assigned from money without an account. Choose “Yes” if you already recorded this balance to avoid counting it twice.</p>`,d=>api('wallet-accounts','POST',{...d,amount:cents(d.amount),request_id}),'Save account');
}
async function prepareReceiptImage(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPG, PNG or WebP receipt.');
  if(file.size>20*1024*1024)throw Error('Choose a receipt photo smaller than 20 MB.');
  if(file.size<=5*1024*1024)return file;
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;await img.decode();
    const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob||blob.size>5*1024*1024)throw Error('Choose a smaller receipt photo.');
    return blob;
  }finally{URL.revokeObjectURL(url);}
}
async function scanReceiptImage(image,signal){
  const response=await fetch('/api/receipts/scan',{method:'POST',headers:{'Content-Type':image.type},body:image,signal});
  let result;try{result=await response.json();}catch{throw Error('Receipt scanning is unavailable. Please try again.');}
  if(!response.ok){
    if(response.status===401){state=null;$('#modal').close();renderAuth();}
    throw Error(typeof result.detail==='string'?result.detail:'Receipt scanning failed. Please try again.');
  }
  return result;
}
function receiptScanModal(){
  if(!state.wallet_accounts?.length){toast('Add an e-wallet or bank account first.');return walletAccountModal();}
  const dialog=$('#modal'),owner=state.user.id,controller=new AbortController();
  dialog.innerHTML=`<div class="modal-head"><h2>Scan a receipt</h2><button type="button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div><form id="receipt-scan-form"><p class="sub">Gemini will read the amount and category. You choose the account before any deduction.</p><label for="receipt-file">Choose a receipt photo</label><input id="receipt-file" type="file" accept="image/jpeg,image/png,image/webp"><label for="receipt-camera">Or take a photo</label><input id="receipt-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"><img id="receipt-preview" class="receipt-preview" alt="Selected receipt" hidden><label class="receipt-consent"><input type="checkbox" id="receipt-consent" required><span>Send this receipt image to Google Gemini to extract the expense. Penny Wais saves the extracted details, not the photo.</span></label><p class="form-error" role="alert"></p><p id="receipt-progress" class="sub" role="status"></p><div class="form-actions"><button type="button" class="btn" data-action="close">Cancel</button><button type="submit" class="btn primary">Scan with Gemini</button></div></form>`;
  dialog.showModal();
  const form=$('#receipt-scan-form');let chosen,previewURL;
  const cleanup=()=>{controller.abort();if(previewURL)URL.revokeObjectURL(previewURL);};
  dialog.addEventListener('close',cleanup,{once:true});
  for(const id of ['receipt-file','receipt-camera'])$('#'+id).onchange=e=>{
    chosen=e.target.files[0];
    if(previewURL)URL.revokeObjectURL(previewURL);
    const preview=$('#receipt-preview');preview.hidden=true;
    if(chosen&&['image/jpeg','image/png','image/webp'].includes(chosen.type)){previewURL=URL.createObjectURL(chosen);preview.src=previewURL;preview.hidden=false;}
  };
  form.onsubmit=async e=>{
    e.preventDefault();if(!$('#receipt-consent').checked)return;
    const button=form.querySelector('[type=submit]'),active=()=>dialog.open&&$('#receipt-scan-form')===form&&state?.user.id===owner;
    button.disabled=true;form.querySelector('.form-error').textContent='';$('#receipt-progress').textContent='Reading your receipt…';
    try{
      const image=await prepareReceiptImage(chosen);if(!active())return;
      const result=await scanReceiptImage(image,controller.signal);if(!active())return;
      dialog.removeEventListener('close',cleanup);cleanup();receiptReviewModal(result);
    }catch(err){if(active()&&err.name!=='AbortError')form.querySelector('.form-error').textContent=err.message;}
    finally{button.disabled=false;if(active())$('#receipt-progress').textContent='';}
  };
}
function receiptReviewModal(result){
  const a=result.analysis,validDate=a.receipt_date&&a.receipt_date<=today()?a.receipt_date:today();
  const note=a.amount===null?'The total was unclear. Enter the amount shown on your receipt.':'Check the total against your receipt before saving.';
  modal('Choose the account you paid from',`<p class="sub">${note}${a.currency==='UNKNOWN'?' Confirm the receipt is in Philippine pesos.':''}${!a.receipt_date||a.receipt_date>today()?' The date needs checking; today is selected.':''}</p>`+accountSelect('Deduct from',null,true)+field('amount','Receipt total (₱)','number',a.amount===null?'':(a.amount/100).toFixed(2),'required min="0.01" max="100000000" step="0.01"')+field('description','Description','text',a.description,'required maxlength="120"')+select('category','Category',categories,a.category)+field('date','Date','date',validDate,`required max="${today()}"`)+`<p id="receipt-balance-preview" class="receipt-balance-preview" role="status">Choose the account you used for this purchase.</p>`,d=>api(`receipts/${result.id}/confirm`,'POST',{account_id:Number(d.account_id),amount:cents(d.amount),description:d.description,category:d.category,date:d.date}),'Save and deduct');
  const preview=()=>{
    const account=(state.wallet_accounts||[]).find(x=>x.id===Number($('#f-account_id').value));if(!account)return;
    let amount;try{amount=cents($('#f-amount').value);}catch{return;}
    $('#receipt-balance-preview').textContent=amount>account.balance?'Not enough recorded money in this account.':amount>state.unallocated?'Release bucket funds before spending this amount.':`${account.name}: ${money(account.balance)} → ${money(account.balance-amount)} after saving.`;
  };
  $('#f-account_id').addEventListener('change',preview);$('#f-amount').addEventListener('input',preview);
}

function exportCSV(){const protect=v=>{const s=String(v);return '"'+(/^[=+\-@\t\r]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';};const rows=[['Date','Description','Type','Category','Amount (PHP)'],...state.transactions.map(t=>[t.date,t.description,t.kind,t.category,(t.amount/100).toFixed(2)])];const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(protect).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='penny-wais-transactions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your transaction export is ready.');}
const concernStatus={open:'Open',in_progress:'In progress',resolved:'Resolved'};
async function loadMyConcerns(){
  const container=$('#my-concerns'),owner=state?.user.id;
  try{
    const result=await api('concerns');
    if(page!=='help'||state?.user.id!==owner||$('#my-concerns')!==container)return;
    container.innerHTML='<h3>Your support requests</h3>'+ (result.concerns.length?result.concerns.map(c=>`<div class="support-request"><span class="pill">${concernStatus[c.status]||esc(c.status)}</span><p>${esc(c.message)}</p>${c.reply?`<p class="support-reply"><strong>Admin reply</strong><br>${esc(c.reply)}</p>`:''}</div>`).join(''):'<p class="sub">No support requests yet.</p>');
  }catch(e){if(page==='help'&&state?.user.id===owner&&$('#my-concerns')===container)container.textContent=e.message;}
}
async function loadAdmin(){
  const container=$('#admin-content'),owner=state?.user.id;
  try{
    const a=await api('admin');
    if(page!=='admin'||!container||$('#admin-content')!==container||state?.user.id!==owner||state?.user.role!=='admin')return;
    container.innerHTML=`<div class="admin-stats">${[['Accounts',a.stats.users],['Active accounts',a.stats.active_users],['Administrators',a.stats.admins],['Active sessions',a.stats.sessions],['Open concerns',a.stats.open_concerns],['Shared groups',a.stats.groups]].map(([label,count])=>`<div><strong>${count}</strong><span>${label}</span></div>`).join('')}</div><h2>Accounts</h2><p class="sub">Manage access and help users recover their accounts. Passwords and personal financial records stay private.</p><div class="filters admin-filters"><input id="admin-search" aria-label="Search accounts" placeholder="Search name or email"><select id="admin-filter" aria-label="Filter accounts">${options(['All accounts','Active','Disabled','Administrators','Locked'])}</select></div><div id="admin-users"></div><h2 class="admin-heading">Reported concerns</h2><div id="admin-concerns"></div><h2 class="admin-heading">Service setup</h2><p class="sub">Configuration status only; this does not test delivery or provider availability.</p>${Object.entries({email:'Email recovery',ai:'Gemini AI',bank_sandbox:'Brankas sandbox'}).map(([key,label])=>`<div class="balance-row"><span>${label}</span><span class="pill">${a.services[key]?'Configured':'Needs setup'}</span></div>`).join('')}<h2 class="admin-heading">Recent admin activity</h2><p class="sub">Latest 100 actions. Reset codes and passwords are never included.</p>${a.audit.length?`<div class="table-wrap"><table><thead><tr><th>Action</th><th>Administrator</th><th>Date</th></tr></thead><tbody>${a.audit.map(r=>`<tr><td>${esc(r.action.replaceAll('_',' '))}<small class="sub">${r.action==='concern_updated'?'Concern':'Account'} #${r.target_id}${r.detail?' · '+esc(r.detail):''}</small></td><td>${esc(r.actor)}</td><td>${new Date(r.created*1000).toLocaleString('en-PH')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="sub">Admin actions will appear here.</p>'}`;
    const drawUsers=()=>{
      const q=$('#admin-search').value.trim().toLowerCase(),filter=$('#admin-filter').value;
      const users=a.users.filter(u=>(u.name+' '+u.email).toLowerCase().includes(q)&&(filter==='All accounts'||filter==='Active'&&u.active||filter==='Disabled'&&!u.active||filter==='Administrators'&&u.role==='admin'||filter==='Locked'&&u.locked>Date.now()/1000));
      $('#admin-users').innerHTML=users.length?users.map(u=>`<div class="admin-row"><div><strong>${esc(u.name)}</strong><p class="sub">${esc(u.email)}</p><p class="sub">${u.active?'Active':'Disabled'} · ${u.role==='admin'?'Administrator':'User'} · ${u.sessions} sessions${u.locked>Date.now()/1000?' · Login locked':''}</p></div>${u.id!==owner?`<div class="admin-actions"><button class="btn small" data-user="${u.id}" data-active="${u.active?0:1}">${u.active?'Disable':'Enable'}</button>${u.active?`<button class="btn small" data-reset-user="${u.id}" data-reset-email="${esc(u.email)}">Reset password</button><button class="btn small" data-admin-user="${u.id}" data-admin-action="role" data-role="${u.role==='admin'?'user':'admin'}">${u.role==='admin'?'Make user':'Make admin'}</button>${u.sessions?`<button class="btn small" data-admin-user="${u.id}" data-admin-action="sign-out">Sign out devices</button>`:''}${u.locked>Date.now()/1000?`<button class="btn small" data-admin-user="${u.id}" data-admin-action="unlock">Unlock login</button>`:''}`:''}</div>`:'<span class="pill">You</span>'}</div>`).join(''):'<p class="sub">No matching accounts.</p>';
    };
    drawUsers();$('#admin-search').addEventListener('input',drawUsers);$('#admin-filter').addEventListener('change',drawUsers);
    $('#admin-concerns').innerHTML=a.concerns.length?a.concerns.map(c=>`<div class="admin-row"><div><strong>${esc(c.reporter)}</strong><p class="sub">${esc(c.reporter_email)} · ${concernStatus[c.status]||esc(c.status)}</p><p class="support-message">${esc(c.message)}</p>${c.reply?`<p class="support-reply">${esc(c.reply)}</p>`:''}</div><button class="btn small" data-concern="${c.id}">Reply / update</button></div>`).join(''):'<p class="sub">No concerns reported.</p>';
    for(const button of container.querySelectorAll('[data-concern]'))button.onclick=()=>{
      const c=a.concerns.find(c=>c.id===Number(button.dataset.concern));
      modal('Respond to a concern',`<p>${esc(c.message)}</p><label for="f-status">Status</label><select name="status" id="f-status">${Object.entries(concernStatus).map(([value,label])=>`<option value="${value}" ${c.status===value?'selected':''}>${label}</option>`).join('')}</select><label for="f-reply">Reply to the user</label><textarea id="f-reply" name="reply" maxlength="2000">${esc(c.reply)}</textarea><p class="sub">Your reply appears in the user’s Help → Your support requests.</p>`,d=>api(`admin/concerns/${c.id}`,'PUT',d),'Save reply and status');
    };
  }catch(e){if(state?.user.id===owner&&$('#admin-content')===container)toast(e.message);}
}
async function adminUserAction(el){
  const action=el.dataset.adminAction,uid=el.dataset.adminUser;
  const message=action==='role'?(el.dataset.role==='admin'?'Grant administrator access? This person will be able to manage users and concerns. Their sessions will end.':'Remove administrator access and sign this person out?'):action==='sign-out'?'Sign this person out of all devices? They can sign in again.':'Clear this account’s failed login lock?';
  if(!confirm(message))return;
  el.disabled=true;
  try{await api(`admin/users/${uid}/${action}`,action==='role'?'PUT':'POST',action==='role'?{role:el.dataset.role}:{});await loadAdmin();toast('Account updated.');}
  finally{el.disabled=false;}
}
function resetCodeModal(uid,email){
  const dialog=$('#modal'),owner=state.user.id;
  dialog.innerHTML=`<div class="modal-head"><h2>Help reset a password</h2><button data-action="close" type="button" aria-label="Close dialog">${icon('close')}</button></div><form id="reset-code-form"><p>Verify that you are speaking to the owner of <strong>${esc(email)}</strong> before sharing a code.</p><p class="sub reset-help">A new code replaces any earlier code and expires in 15 minutes. Their current password keeps working until they finish the reset.</p><p class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="btn" data-action="close">Cancel</button><button class="btn primary" type="submit">Generate reset code</button></div></form>`;
  dialog.showModal();
  const form=$('#reset-code-form');
  dialog.addEventListener('close',()=>{if($('#reset-code-form')===form)dialog.innerHTML='';},{once:true});
  form.onsubmit=async e=>{
    e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;
    try{
      const result=await api(`admin/users/${uid}/reset-code`,'POST',{});
      if(!dialog.open||$('#reset-code-form')!==form||state?.user.id!==owner)return;
      form.innerHTML=`<p>Give this code only to the verified owner of <strong>${esc(email)}</strong>.</p><label for="reset-code-output">One-time reset code</label><input id="reset-code-output" readonly value="${esc(result.code)}" spellcheck="false"><p class="sub reset-help">Expires in 15 minutes. The user should open Forgot password? on the sign-in page, enter their email and this code, and choose a new password. Completing the reset signs them out of every device.</p><div class="form-actions"><button class="btn" type="button" data-action="copy-reset-code">Copy code</button><button class="btn primary" type="button" data-action="close">Done</button></div>`;
    }catch(err){if($('#reset-code-form')===form)form.querySelector('.form-error').textContent=err.message;}
    finally{button.disabled=false;}
  };
}

document.addEventListener('click',async e=>{const el=e.target.closest('button');if(!el)return;try{if(el.dataset.accountTransaction)return transactionModal(Number(el.dataset.accountTransaction));if(el.dataset.adminAction)return await adminUserAction(el);if(el.dataset.bankAction)return bankAction(el);if(el.dataset.passwordToggle){const input=document.getElementById(el.dataset.passwordToggle);if(!input)return;const visible=input.type==='password';input.type=visible?'text':'password';el.textContent=visible?'Hide':'Show';el.setAttribute('aria-pressed',String(visible));const label=document.querySelector('label[for="'+input.id+'"]')?.textContent||'password';el.setAttribute('aria-label',(visible?'Hide ':'Show ')+label.toLowerCase());return;}if(el.dataset.resetUser)return resetCodeModal(Number(el.dataset.resetUser),el.dataset.resetEmail);if(el.dataset.nav)return nav(el.dataset.nav);if(el.dataset.editBucket)return bucketModal(Number(el.dataset.editBucket));if(el.dataset.editBudget)return budgetModal(Number(el.dataset.editBudget));if(el.dataset.group){selectedGroup=Number(el.dataset.group);render();return;}if(el.dataset.delete){if(!confirm('Delete this record? This cannot be undone. Bucket funds will return to your available balance.'))return;await api(el.dataset.delete,'DELETE');$('#modal').close();await refresh();toast('Record deleted.');return;}if(el.dataset.user){if(!confirm('Change access for this account? Existing sessions will end.'))return;await api('admin/users/'+el.dataset.user,'PUT',{active:el.dataset.active==='1'});await loadAdmin();return;}if(el.dataset.resolve){await api('admin/concerns/'+el.dataset.resolve+'/resolve','POST');await loadAdmin();return;}switch(el.dataset.action){case'auth-toggle':authNotice='';authMode=authMode==='login'?'register':'login';renderAuth();break;case'auth-forgot':recoveryEmail=$('#email')?.value||recoveryEmail;authNotice='';authMode='forgot';renderAuth();break;case'auth-reset':recoveryEmail=$('#email')?.value||recoveryEmail;authNotice='';authMode='reset';renderAuth();break;case'auth-login':recoveryEmail='';authNotice='';authMode='login';renderAuth();break;case'copy-reset-code':{const input=$('#reset-code-output');try{if(!navigator.clipboard)throw Error();await navigator.clipboard.writeText(input.value);toast('Reset code copied.');}catch{input.focus();input.select();toast('Code selected. Use Copy to copy it.');}break;}case'logout':await api('logout','POST');state=null;authMode='login';renderAuth();break;case'close':$('#modal').close();break;case'wallet-account':walletAccountModal();break;case'scan-receipt':receiptScanModal();break;case'transaction':transactionModal();break;case'bucket':bucketModal();break;case'budget':budgetModal();break;case'demo':el.disabled=true;await api('demo','POST');await refresh();toast('Sample data added to your account.');break;case'group':modal('A little teamwork',field('name','Group name','text','','required maxlength="60"')+field('description','Description','text','','maxlength="180"'),d=>api('groups','POST',d),'Create group');break;case'join':modal('Join your people',field('code','Private invite code','text','','required maxlength="80"')+'<p class="sub" style="margin-top:12px">Joining shares your name with the group and gives you access to its expense records.</p>',d=>api('groups/join','POST',d),'Accept invitation');break;case'shared-expense':sharedExpenseModal();break;case'payment':paymentModal();break;case'copy-invite':await navigator.clipboard.writeText(state.groups.find(g=>g.id===selectedGroup).code);toast('Invite code copied. Share it with your group.');break;case'export':exportCSV();break;case'concern':modal('Tell us what happened','<label for="f-message">Your concern</label><textarea id="f-message" name="message" required minlength="5" maxlength="2000" placeholder="Describe the issue you encountered…"></textarea>',d=>api('concerns','POST',d),'Send concern');break;}}catch(err){toast(err.message);el.disabled=false;}});
window.addEventListener('hashchange',()=>{const p=location.hash.slice(1);if(p&&p!==page){page=p;selectedGroup=null;if(state)render();}});
(async()=>{page=location.hash.slice(1)||'dashboard';try{await refresh();}catch{renderAuth();}let version;setInterval(async()=>{try{const d=await api('dev-version');if(version!==undefined&&d.version&&version!==d.version){if(!$('#modal').open&&!document.activeElement?.matches('input,textarea,select'))location.reload();}else version=d.version;}catch{}},1800);})();
// Refresh incoming shared payments on wallet screens without interrupting forms.
setInterval(async()=>{if(state&&['shared','dashboard','buckets','transactions','accounts'].includes(page)&&!document.hidden&&!$('#modal').open&&!document.activeElement?.matches('input,textarea,select')){try{await refresh();}catch(e){toast(e.message);}}},20000);
