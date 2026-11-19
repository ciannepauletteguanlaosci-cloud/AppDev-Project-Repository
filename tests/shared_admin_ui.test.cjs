const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');

function harness(){
  const nodes=new Map(),timers=[];
  const node=s=>{
    if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',value:'',open:false,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;},querySelectorAll(){return [];}});
    return nodes.get(s);
  };
  const context=vm.createContext({document:{querySelector:node,addEventListener(){},hidden:false},window:{addEventListener(){}},location:{hash:''},setInterval(fn,delay){timers.push({fn,delay});},fetch:()=>new Promise(()=>{}),crypto:webcrypto,console,Intl,Date});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/static/app.js'),'utf8'),context);
  const run=s=>vm.runInContext(s,context);
  run(`globalThis.requests=[];api=async(path,method,body)=>{requests.push({path,method,body});return {ok:true}};
    modal=(title,fields,save)=>{globalThis.form={title,fields,save}};
    state={user:{id:1,name:'Ana',role:'admin'},unallocated:20000,groups:[{id:8,members:[{id:1,name:'Ana',balance:-5000},{id:2,name:'Ben',balance:5000}]}]};selectedGroup=8;`);
  return {node,run,timers};
}

test('shared forms retain the same request ID on retry and use a new one for new records',async()=>{
  const {run}=harness();
  run('sharedExpenseModal()');
  assert.match(run('form.fields'),/full amount will be deducted/);
  run(`globalThis.data={description:'Dinner',amount:'100',split:'Equally','member-1':'on','member-2':'on'};`);
  await run('form.save(data)');await run('form.save(data)');
  assert.equal(run('requests[0].body.request_id'),run('requests[1].body.request_id'));
  assert.equal(run('requests[0].body.amount'),10000);
  run('sharedExpenseModal()');await run('form.save(data)');
  assert.notEqual(run('requests[0].body.request_id'),run('requests[2].body.request_id'));
  run('paymentModal()');
  assert.match(run('form.fields'),/credits the recipient/);
  await run("form.save({receiver:'2',amount:'50'})");await run("form.save({receiver:'2',amount:'50'})");
  assert.equal(run('requests[3].body.request_id'),run('requests[4].body.request_id'));
  assert.equal(run('requests[3].body.receiver'),2);
});

test('generated wallet entries cannot be independently deleted in the transaction list',()=>{
  const {run}=harness();
  const html=run(`transactionTable([{id:9,description:'Dinner',kind:'expense',category:'Shared expenses',date:'2026-11-20',amount:10000,source:'shared_expense'},{id:10,description:'Lunch',kind:'expense',category:'Food',date:'2026-11-20',amount:500,source:null}],true)`);
  assert(html.includes('Shared record'));
  assert(!html.includes('data-delete="transactions/9"'));
  assert(html.includes('data-delete="transactions/10"'));
});

test('admin list escapes user content and filters accounts by email and access',async()=>{
  const {node,run}=harness();
  node('#admin-filter').value='All accounts';
  run(`page='admin';api=async()=>({stats:{users:2,active_users:1,admins:1,sessions:1,open_concerns:0,groups:0},users:[{id:1,name:'Ana',email:'ana@example.com',role:'admin',active:1,sessions:1,locked:0},{id:2,name:'<img src=x>',email:'ben@example.com',role:'user',active:0,sessions:0,locked:0}],concerns:[],audit:[],services:{email:true,ai:false,bank_sandbox:false}})`);
  await run('loadAdmin()');
  assert(node('#admin-users').innerHTML.includes('&lt;img src=x&gt;'));
  assert(!node('#admin-users').innerHTML.includes('<img'));
  assert(!node('#admin-users').innerHTML.includes('data-user="1"'));
  assert(node('#admin-content').innerHTML.includes('Recent admin activity'));
  node('#admin-search').value='ben@';node('#admin-search').handlers.input();
  assert(!node('#admin-users').innerHTML.includes('ana@example.com'));
  node('#admin-filter').value='Active';node('#admin-filter').handlers.change();
  assert(node('#admin-users').innerHTML.includes('No matching accounts'));
});

test('pending admin and support responses are discarded after switching users',async()=>{
  for(const [page,loader,selector] of [['admin','loadAdmin','#admin-content'],['help','loadMyConcerns','#my-concerns']]){
    const {run,node}=harness();
    run(`page='${page}';api=()=>new Promise(resolve=>globalThis.resolveResponse=resolve)`);
    const pending=run(`${loader}()`);
    run('state={user:{id:2,role:"user"}};resolveResponse({})');
    await pending;
    assert.equal(node(selector).innerHTML,'');
  }
});

test('support replies escape content and show the progress state',async()=>{
  const {run,node}=harness();
  run(`page='help';api=async()=>({concerns:[{status:'in_progress',message:'Help <script>',reply:'Open <img src=x> Transactions'}]})`);
  await run('loadMyConcerns()');
  const html=node('#my-concerns').innerHTML;
  assert(html.includes('In progress')&&html.includes('Admin reply'));
  assert(html.includes('&lt;script&gt;')&&html.includes('&lt;img src=x&gt;'));
  assert(!html.includes('<script>')&&!html.includes('<img'));
});

test('wallet screens refresh received payments but never interrupt an open form',async()=>{
  const {run,node,timers}=harness();
  run('page="dashboard";globalThis.refreshCount=0;refresh=async()=>{refreshCount++}');
  const tick=timers.find(t=>t.delay===20000).fn;
  await tick();assert.equal(run('refreshCount'),1);
  node('#modal').open=true;
  await tick();assert.equal(run('refreshCount'),1);
});
