const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {innerHTML: '', textContent: '', disabled: false});
    return nodes.get(id);
  };
  let assigned;
  const context = vm.createContext({
    document: {querySelector: node, addEventListener() {}},
    window: {addEventListener() {}},
    location: {hash: '', assign(url) { assigned = url; }},
    setInterval() {}, fetch: () => new Promise(() => {}),
    confirm: () => true, Intl, Date, encodeURIComponent,
  });
  const run = code => vm.runInContext(code, context);
  run(fs.readFileSync(path.join(__dirname, '../app/static/app.js'), 'utf8'));
  run("state={user:{id:1}};page='connections';globalThis.requests=[];");
  return {node, run, redirect: () => assigned};
}

test('link opens provider authorization only after a successful API response', async () => {
  const {run, redirect} = harness();
  run("api=async(path,method)=>{requests.push({path,method});return {redirect_uri:'https://pidp-server.bnk.to/?id=test'};};globalThis.button={dataset:{bankAction:'link'},disabled:false};");
  await run('bankAction(button)');
  assert.equal(redirect(), 'https://pidp-server.bnk.to/?id=test');
  assert.equal(run('requests[0].path'), 'bank-connections');
  assert.equal(run('requests[0].method'), 'POST');
  assert.equal(run('button.disabled'), false);
});

test('provider denial stays visible and allows retry without reporting a connection', async () => {
  const {run, node, redirect} = harness();
  run("api=async()=>{throw Error('Brankas denied Statement access.');};globalThis.button={dataset:{bankAction:'link'},disabled:false};");
  await run('bankAction(button)');
  assert.equal(node('#bank-error').textContent, 'Brankas denied Statement access.');
  assert.equal(redirect(), undefined);
  assert.equal(run('button.disabled'), false);
});

test('pending data is not rendered after switching users', async () => {
  const {run, node} = harness();
  run('api=()=>new Promise(resolve=>{globalThis.finish=resolve;});');
  const pending = run('loadConnections()');
  run("state={user:{id:2}};finish({configured:true,connections:[{id:'private'}]});");
  await pending;
  assert.equal(node('#bank-list').innerHTML, '');
});

test('account summaries escape provider text and distinguish missing balances', () => {
  const {run} = harness();
  const html = run(`bankCards([{id:'test',status:'linked',created:1,accounts:[{name:'<img src=x onerror=alert(1)>',last_four:'1234',balance:null,transaction_count:3}]}])`);
  assert(!html.includes('<img'));
  assert(html.includes('&lt;img'));
  assert(html.includes('Balance unavailable'));
  assert(html.includes('Test account linked'));
  assert(html.includes('Remove from app'));
});

test('overview shows retrieved sandbox balances without changing wallet funds', () => {
  const {run} = harness();
  run('state.balance=50000;state.unallocated=20000;');
  const html = run(`bankOverviewContent([{id:'test',status:'linked',checked:1,accounts:[{name:'<Savings>',last_four:'1234',balance:12345,transaction_count:3}]}])`);
  assert(html.includes('123.45'));
  assert(html.includes('&lt;Savings&gt;'));
  assert(html.includes('Test balances do not change available funds'));
  assert.equal(run('state.balance'), 50000);
  assert.equal(run('state.unallocated'), 20000);
});

test('overview explains pending and empty connections without showing a balance', () => {
  const {run} = harness();
  assert(run('bankOverviewContent([])').includes('No test accounts linked yet'));
  const html = run("bankOverviewContent([{status:'pending',accounts:[]}])");
  assert(html.includes('Awaiting authorization'));
  assert(html.includes('No account balance retrieved'));
  assert(!html.includes('₱'));
});

test('overview ignores a delayed response after signing into another account', async () => {
  const {run, node} = harness();
  run("page='dashboard';api=()=>new Promise(resolve=>{globalThis.finish=resolve;});");
  const pending = run('loadBankOverview()');
  run("state={user:{id:2}};finish({connections:[{status:'linked',accounts:[{name:'Private'}]}]});");
  await pending;
  assert.equal(node('#bank-overview').innerHTML, '');
});

test('wallet summary displays separate total, recorded and sandbox cards', () => {
  const {run} = harness();
  run('Object.assign(state,{balance:4088000,unallocated:4088000,connected_balance:54310000,connected_accounts:1,wallet_total:58398000,missing_bank_balances:2});');
  const html = run('walletBalanceContent()');
  assert(html.includes('583,980.00'));
  assert(html.includes('Recorded money'));
  assert(html.includes('40,880.00')); 
  assert(html.includes('Sandbox accounts'));
  assert(html.includes('543,100.00'));
  assert(!html.includes(' recorded + '));
  assert(html.includes('Sandbox included'));
  assert(html.includes('2 accounts without a PHP balance excluded'));
});

test('returning to Overview updates the total after connection changes', async () => {
  const {run, node} = harness();
  run("page='dashboard';state.wallet_total=0;api=async()=>({connections:[],wallet_summary:{balance:10000,unallocated:10000,wallet_total:25000,connected_balance:15000,connected_accounts:1}});");
  await run('loadBankOverview()');
  assert.equal(run('state.wallet_total'), 25000);
  assert(node('#wallet-balance').innerHTML.includes('250.00'));
});
