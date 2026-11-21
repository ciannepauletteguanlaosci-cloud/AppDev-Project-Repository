const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');

function harness(){
  const nodes=new Map();
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{
      innerHTML:'',textContent:'',value:'',open:false,checked:false,handlers:{},files:[],disabled:false,
      querySelector:node,showModal(){this.open=true;},close(){this.open=false;},
      addEventListener(event,fn){this.handlers[event]=fn;},removeEventListener(event){delete this.handlers[event];},
    });
    return nodes.get(selector);
  };
  const context=vm.createContext({document:{querySelector:node,addEventListener(){}},window:{addEventListener(){}},location:{hash:''},setInterval(){},fetch:()=>new Promise(()=>{}),crypto:webcrypto,AbortController,URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},console,Date,Intl});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/static/app.js'),'utf8'),context);
  const run=s=>vm.runInContext(s,context);
  run(`globalThis.calls=[];api=async(path,method,body)=>{calls.push({path,method,body});return {ok:true}};
    modal=(title,fields,save,label)=>{globalThis.review={title,fields,save,label}};
    state={user:{id:1,name:'Ana',role:'user',wallet_preview:true},transactions:[],buckets:[],budgets:[],forecast:{ready:false},balance:120000,unallocated:110000,unassigned_balance:0,wallet_accounts:[{id:1,provider:'GCash',name:'My GCash',balance:100000},{id:2,provider:'BPI',name:'BPI savings',balance:20000}]};`);
  return {run,node};
}

test('receipt review requires an account and saves edited details only after submit',async()=>{
  const {run,node}=harness();
  run(`receiptReviewModal({id:9,analysis:{amount:12345,description:'Cafe <img>',category:'Food',receipt_date:today(),currency:'PHP'}})`);
  const html=run('review.fields');
  assert.match(html,/name="account_id" required/);
  assert.match(html,/Choose an account/);
  assert.match(html,/My GCash/);assert.match(html,/BPI savings/);
  assert.match(html,/123.45/);assert.match(html,/Cafe &lt;img&gt;/);
  assert.equal(run('calls.length'),0);
  node('#f-account_id').value='2';node('#f-amount').value='120.00';
  node('#f-account_id').handlers.change();
  assert(node('#receipt-balance-preview').textContent.includes('80.00'));
  await run("review.save({account_id:'2',amount:'120.00',description:'Corrected lunch',category:'Food',date:today()})");
  assert.equal(run('calls[0].path'),'receipts/9/confirm');
  assert.equal(run('calls[0].body.account_id'),2);
  assert.equal(run('calls[0].body.amount'),12000);
  assert.equal(run('calls[0].body.description'),'Corrected lunch');
});

test('receipt preview explains insufficient account funds and reserved money',()=>{
  const {run,node}=harness();
  run(`receiptReviewModal({id:1,analysis:{amount:null,description:'Receipt',category:'Other',receipt_date:null,currency:'UNKNOWN'}})`);
  assert.match(run('review.fields'),/total was unclear/);
  assert.match(run('review.fields'),/Philippine pesos/);
  node('#f-account_id').value='2';node('#f-amount').value='300';node('#f-amount').handlers.input();
  assert.match(node('#receipt-balance-preview').textContent,/Not enough/);
  run('state.unallocated=100');node('#f-amount').value='50';node('#f-amount').handlers.input();
  assert.match(node('#receipt-balance-preview').textContent,/Release bucket/);
});

test('every signed-in user can reach wallet and receipt features from desktop and mobile',()=>{
  for(const role of ['user','admin']){
    const {run,node}=harness();
    run(`state.user.role='${role}';state.user.wallet_preview=false;page='accounts';render();`);
    const html=node('#app').innerHTML;
    const mobile=html.match(/<nav class="mobile-menu-links"[^>]*>(.*?)<\/nav>/s)[1];
    assert.match(mobile,/data-nav="accounts" aria-current="page"/);
    assert.match(mobile,/data-nav="budgets"/);
    assert.match(mobile,/data-nav="connections"/);
    assert.match(html,/Your money, by account/);
    for(const dest of ['admin','database']){
      assert.equal(mobile.includes(`data-nav="${dest}"`),role==='admin');
      assert.equal(html.includes(`data-nav="${dest}"`),role==='admin');
    }
    for(const screen of ['dashboard()','transactions()','accountsPage()']){
      assert.match(run(screen),/data-action="scan-receipt"/);
    }
    assert.match(run('help()'),/data-nav="accounts"/);
  }
});

test('ordinary users cannot open Admin or Database using a direct URL',()=>{
  for(const destination of ['admin','database']){
    const {run,node}=harness();
    run(`page='${destination}';location.hash='#${destination}';
      location.replace=hash=>location.hash=hash;loadBankOverview=()=>{};render();`);
    assert.equal(run('page'),'dashboard');
    assert.equal(run('location.hash'),'#dashboard');
    assert.doesNotMatch(node('#app').innerHTML,/data-nav="admin"|data-nav="database"|id="admin-content"|id="database-view"/);
  }
});

test('account setup supports assigning existing funds and protects retries',async()=>{
  const {run}=harness();run('walletAccountModal()');
  for(const provider of ['GCash','Maya','UnionBank','BPI','Metrobank'])assert(run('review.fields').includes(provider));
  assert(run('review.fields').includes('assign my existing money'));
  await run("review.save({provider:'GCash',name:'Daily spending',amount:'2500.50',funding:'existing'})");
  await run("review.save({provider:'GCash',name:'Daily spending',amount:'2500.50',funding:'existing'})");
  assert.equal(run('calls[0].body.amount'),250050);
  assert.equal(run('calls[0].body.funding'),'existing');
  assert.equal(run('calls[0].body.request_id'),run('calls[1].body.request_id'));
});

test('scan waits for image-sharing consent and opens review without deducting',async()=>{
  const {run,node}=harness();
  run(`globalThis.scans=0;prepareReceiptImage=async()=>({type:'image/png'});scanReceiptImage=async()=>{scans++;return {id:9,analysis:{amount:12345,description:'Cafe',category:'Food',receipt_date:today(),currency:'PHP'}}};receiptScanModal()`);
  const form=node('#receipt-scan-form');
  await form.onsubmit({preventDefault(){}});assert.equal(run('scans'),0);
  node('#receipt-consent').checked=true;
  await form.onsubmit({preventDefault(){}});
  assert.equal(run('scans'),1);
  assert.equal(run('calls.length'),0);
  assert.equal(run('review.label'),'Save and deduct');
});

test('scan response is ignored when user closes popup or switches account',async()=>{
  for(const abandon of ["$('#modal').close()","state.user.id=2"]){
    const {run,node}=harness();
    run(`prepareReceiptImage=async()=>({type:'image/png'});scanReceiptImage=()=>new Promise(resolve=>globalThis.finishScan=resolve);receiptScanModal()`);
    node('#receipt-consent').checked=true;
    const pending=node('#receipt-scan-form').onsubmit({preventDefault(){}});
    await Promise.resolve();await Promise.resolve();
    run(`${abandon};finishScan({id:9,analysis:{}})`);
    await pending;
    assert.equal(run('typeof review'),'undefined');
    assert.equal(run('calls.length'),0);
  }
});

test('unsupported and oversized images fail before upload',async()=>{
  const {run}=harness();
  await assert.rejects(run("prepareReceiptImage({type:'application/pdf',size:10})"),/JPG, PNG or WebP/);
  await assert.rejects(run("prepareReceiptImage({type:'image/png',size:21*1024*1024})"),/20 MB/);
  const result=await run("prepareReceiptImage({type:'image/jpeg',size:100})");
  assert.equal(result.size,100);
});
