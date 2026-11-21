const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function element(){
  const children=new Map();
  return {
    value:'',textContent:'',disabled:false,dataset:{},html:'',
    set innerHTML(markup){this.html=markup;children.clear();},
    get innerHTML(){return this.html;},
    querySelector(selector){
      if(!children.has(selector))children.set(selector,element());
      return children.get(selector);
    },
    querySelectorAll(selector){
      if(selector!=='[data-db-edit]')return [];
      return Array.from(this.html.matchAll(/data-db-edit="(\d+)"/g),([,index])=>{
        const button=this.querySelector('edit-'+index);
        button.dataset.dbEdit=index;
        return button;
      });
    },
    replaceChildren(){this.innerHTML='';},
  };
}
function harness(){
  const doc=element(),timers=new Map(),events=[];
  doc.addEventListener=()=>{};
  const context=vm.createContext({
    document:doc,window:{addEventListener(){}},location:{hash:''},setInterval(){},
    setTimeout(fn,delay){timers.set(fn,delay);return fn;},clearTimeout(fn){timers.delete(fn);},
    fetch:()=>new Promise(()=>{}),events,
    FormData:class{constructor(form){this.values=form.values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}},
  });
  for(const file of ['database.js','app.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../app/static',file),'utf8'),context);
  }
  const run=source=>vm.runInContext(source,context);
  run(`state={user:{id:1,role:'admin',name:'Taylor'}};page='database';toast=()=>{};
    api=async(path,method,body,headers)=>{
      events.push({path,method,body,headers});
      if(path.endsWith('/unlock'))return {key:'temporary-key',expires_in:300};
      if(path.endsWith('/lock'))return {ok:true};
      return {rows:[{id:7,name:'<script>',revision:'v1',email:'test@example.com',role:'user',active:1}],next:null};
    };
    bindDatabaseView();`);
  return {panel:doc.querySelector('#database-view'),run,events,timers};
}

test('database requests no records until password submission, then locks when leaving',async()=>{
  const {panel,run,events}=harness();
  assert.match(panel.innerHTML,/Unlock database/);
  assert.equal(events.length,0);
  const form=panel.querySelector('form');
  form.querySelector('input').value='test-password';
  await form.onsubmit({preventDefault(){}});
  assert.equal(form.querySelector('input').value,'');
  assert.equal(events[0].path,'admin/database/unlock');
  assert.equal(events[1].headers['X-Database-Key'],'temporary-key');
  assert.match(panel.querySelector('#db-results').innerHTML,/&lt;script&gt;/);
  run("page='help';closeDatabaseView()");
  assert.equal(events.at(-1).path,'admin/database/lock');
  assert.equal(panel.innerHTML,'');
});

test('database access timeout hides visible records and prompts for a password',async()=>{
  const {panel,timers}=harness();
  await panel.querySelector('form').onsubmit({preventDefault(){}});
  const [expire,delay]=[...timers.entries()][0];
  assert.equal(delay,300000);
  expire();
  assert.match(panel.innerHTML,/Unlock database/);
  assert.match(panel.querySelector('form').querySelector('.form-error').textContent,/expired/);
});

test('saving an edited row includes its revision and reloads the record list',async()=>{
  const {panel,events}=harness();
  await panel.querySelector('form').onsubmit({preventDefault(){}});
  panel.querySelector('#db-results').querySelectorAll('[data-db-edit]')[0].onclick();
  const form=panel.querySelector('form');
  assert.match(panel.innerHTML,/Edit user #7/);
  assert.match(panel.innerHTML,/Sign-in email/);
  assert.match(panel.innerHTML,/name="role"/);
  assert.match(panel.innerHTML,/name="access"/);
  form.values={name:'Updated name',email:'new@example.com',role:'Administrator',access:'Disabled'};
  await form.onsubmit({preventDefault(){}});
  const update=events.find(e=>e.method==='PUT');
  assert.equal(update.path,'admin/database/users/7');
  assert.equal(update.headers['X-Database-Key'],'temporary-key');
  assert.equal(update.body.name,'Updated name');
  assert.equal(update.body.email,'new@example.com');
  assert.equal(update.body.role,'admin');
  assert.equal(update.body.active,false);
  assert.equal(update.body.revision,'v1');
  assert.match(panel.innerHTML,/Find a record/);
});

test('self-edit only submits profile fields and budget editors convert pesos to centavos',()=>{
  const {run}=harness();
  assert.doesNotMatch(run("databaseTables.users.fields({id:1,name:'Taylor',role:'admin',email:'a@example.com',active:1})"),/name="(role|access)"/);
  assert.equal(run("databaseTables.users.payload({name:'Taylor',email:'a@example.com'}).active"),undefined);
  assert.match(run("databaseTables.budgets.fields({category:'Food',amount:12550})"),/125.50/);
  assert.equal(run("databaseTables.budgets.payload({category:'Food',amount:'120.25'}).amount"),12025);
  const bucket=run("databaseTables.buckets.payload({name:'Reserve',category:'Savings',amount:'0',target:'800.05'})");
  assert.equal(bucket.amount,0);
  assert.equal(bucket.target,80005);
});
