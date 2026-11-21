'use strict';

function bindDatabaseView(){
  const panel=$('#database-view');
  if(!panel || state?.user.role!=='admin')return;
  const owner=state.user.id;
  let key='',timer,rows=[],next=null,version=0,table='users',search='',cursor=null;
  let previous=[];
  const current=()=>page==='database' && state?.user.id===owner && $('#database-view')===panel;
  const headers=()=>({'X-Database-Key':key});
  function lock(message=''){
    ++version;
    clearTimeout(timer);
    const oldKey=key;
    key=''; rows=[]; previous=[]; next=null; cursor=null; search='';
    if(oldKey)api('admin/database/lock','POST',null,{'X-Database-Key':oldKey}).catch(()=>{});
    if(!current())return;
    panel.innerHTML='<form class="database-unlock"><h2>Unlock database</h2><p class="sub">Enter your administrator password. Access lasts five minutes.</p>'+
      passwordField('database-password','Administrator password')+
      '<p class="form-error" role="alert"></p><button class="btn primary" type="submit">Unlock database</button></form>';
    const form=panel.querySelector('form');
    form.querySelector('.form-error').textContent=message;
    form.onsubmit=async e=>{
      e.preventDefault();
      const input=form.querySelector('input');
      const button=form.querySelector('[type="submit"]');
      button.disabled=true;
      try{
        const pending=api('admin/database/unlock','POST',{password:input.value});
        input.value='';
        const grant=await pending;
        if(!current() || panel.querySelector('form')!==form){
          api('admin/database/lock','POST',null,{'X-Database-Key':grant.key}).catch(()=>{});
          return;
        }
        key=grant.key;timer=setTimeout(()=>lock('Access expired. Enter your password to continue.'),grant.expires_in*1000);
        await load();
      }catch(error){
        form.querySelector('.form-error').textContent=error.message;
      }finally{button.disabled=false;}
    };
  }
  closeDatabaseView=()=>{
    closeDatabaseView=null;
    lock();
    panel.replaceChildren();
  };
  function layout(){
    return '<div class="card-head"><h2>Database records</h2><button class="btn small" data-db-lock>Lock database</button></div>'+
      '<form class="database-tools"><div><label for="db-table">Table</label><select id="db-table">'+
      Object.entries(databaseTables).map(([id,t])=>`<option value="${id}" ${id===table?'selected':''}>${t.title}</option>`).join('')+
      '</select></div><div><label for="db-search">Find a record</label><input id="db-search" type="search" maxlength="100" placeholder="Search by ID or text" value="'+esc(search)+'"></div>'+
      '<button class="btn" type="submit">Search</button></form><div id="db-results" aria-live="polite"></div>';
  }
  async function load(){
    const sequence=++version;
    panel.innerHTML=layout();
    panel.querySelector('[data-db-lock]').onclick=()=>lock();
    panel.querySelector('#db-table').onchange=e=>{table=e.target.value;search='';cursor=null;previous=[];load();};
    panel.querySelector('.database-tools').onsubmit=e=>{e.preventDefault();search=panel.querySelector('#db-search').value.trim();cursor=null;previous=[];load();};
    const results=panel.querySelector('#db-results');
    results.textContent='Loading records…';
    try{
      const url='admin/database/'+table+'?q='+encodeURIComponent(search)+(cursor?'&before='+cursor:'');
      const data=await api(url,'GET',null,headers());
      if(!current()||sequence!==version)return;
      rows=data.rows;next=data.next;
      const config=databaseTables[table];
      const body=rows.map((row,i)=>'<tr>'+config.columns.map(([name])=>'<td>'+esc(config.format?.(name,row)??row[name])+'</td>').join('')+
        '<td>'+(config.editable&&!config.editable(row)?'Linked record':'<button class="btn small" data-db-edit="'+i+'">Edit</button>')+'</td></tr>').join('');
      results.innerHTML=(rows.length?'<div class="table-wrap"><table><thead><tr>'+config.columns.map(([,label])=>'<th>'+label+'</th>').join('')+'<th>Action</th></tr></thead><tbody>'+body+'</tbody></table></div>':'<p>No matching records.</p>')+
        '<div class="database-paging">'+(previous.length?'<button class="btn small" data-db-prev>Previous</button>':'')+(next?'<button class="btn small" data-db-next>Next</button>':'')+'</div>';
      results.querySelectorAll('[data-db-edit]').forEach(button=>button.onclick=()=>edit(rows[Number(button.dataset.dbEdit)]));
      const prev=results.querySelector('[data-db-prev]'),more=results.querySelector('[data-db-next]');
      if(prev)prev.onclick=()=>{cursor=previous.pop();load();};
      if(more)more.onclick=()=>{previous.push(cursor);cursor=next;load();};
    }catch(error){
      if(!current()||sequence!==version)return;
      if(error.status===423||error.status===403)lock(error.message);
      else results.textContent=error.message;
    }
  }
  function edit(row){
    const config=databaseTables[table];
    panel.innerHTML='<form class="database-edit"><h2>Edit '+config.singular+' #'+row.id+'</h2>'+config.fields(row)+
      '<p class="form-error" role="alert"></p><div class="form-actions"><button class="btn" type="button" data-db-cancel>Back</button><button class="btn primary" type="submit">Save changes</button></div></form>';
    panel.querySelector('[data-db-cancel]').onclick=load;
    const form=panel.querySelector('form');
    form.onsubmit=async e=>{
      e.preventDefault();
      const button=form.querySelector('[type="submit"]');
      button.disabled=true;
      try{
        const fields=Object.fromEntries(new FormData(form));
        const result=await api('admin/database/'+table+'/'+row.id,'PUT',{...config.payload(fields),revision:row.revision},headers());
        if(result.sign_in_required && state?.user.id===owner){
          state=null;authMode='login';authNotice='Email updated. Sign in with your new email address.';
          renderAuth();return;
        }
        if(!current()||!key||panel.querySelector('form')!==form)return;
        toast('Changes saved.');await load();
        if(current() && (['transactions','budgets','buckets'].includes(table) || (table==='users' && row.id===owner))){
          const latest=await api('state');
          if(state?.user.id===owner && latest.user.id===owner){
            state=latest;
            if(page!=='database')render();
          }
        }
      }catch(error){
        if(!current()||panel.querySelector('form')!==form)return;
        if(error.status===423||error.status===403)lock(error.message);
        else form.querySelector('.form-error').textContent=error.message;
      }finally{button.disabled=false;}
    };
  }
  lock();
}

const databaseTables={
  users:{
    title:'User accounts',singular:'user',
    columns:[['id','ID'],['name','Name'],['email','Email'],['role','Role'],['active','Access']],
    format:(name,row)=>name==='active'?(row.active?'Active':'Disabled'):undefined,
    fields:row=>field('name','Display name','text',row.name,'required maxlength="60"')+
      field('email','Sign-in email','email',row.email,'required maxlength="160"')+
      (row.id===state.user.id?'':select('role','Role',['User','Administrator'],row.role==='admin'?'Administrator':'User')+
        select('access','Account access',['Active','Disabled'],row.active?'Active':'Disabled'))+
      '<p class="sub">Changing the sign-in email, role or account access signs this user out on all devices.</p>',
    payload:values=>{
      const profile={name:values.name,email:values.email};
      if(values.role)profile.role=values.role==='Administrator'?'admin':'user';
      if(values.access)profile.active=values.access==='Active';
      return profile;
    },
  },
  concerns:{
    title:'Support requests',singular:'support request',
    columns:[['id','ID'],['email','From'],['message','Message'],['status','Status'],['reply','Reply']],
    format:(name,row)=>name==='status'?concernStatus[row.status]:undefined,
    fields:row=>'<p class="support-message">'+esc(row.message)+'</p><label for="db-status">Status</label><select id="db-status" name="status">'+
      Object.entries(concernStatus).map(([id,label])=>`<option value="${id}" ${id===row.status?'selected':''}>${label}</option>`).join('')+'</select>'+
      '<label for="db-reply">Reply</label><textarea id="db-reply" name="reply" maxlength="2000">'+esc(row.reply)+'</textarea>',
    payload:values=>({status:values.status,reply:values.reply}),
  },
  transactions:{
    title:'My transactions',singular:'transaction',
    columns:[['id','ID'],['date','Date'],['description','Description'],['kind','Type'],['category','Category'],['amount','Amount']],
    format:(name,row)=>name==='amount'?money(row.amount):undefined,
    editable:row=>!row.source,
    fields:row=>field('description','Description','text',row.description,'required maxlength="120"')+
      select('kind','Type',['income','expense'],row.kind)+field('category','Category','text',row.category,'required maxlength="40"')+
      field('date','Date','date',row.date,'required max="'+today()+'"')+
      field('amount','Amount (₱)','number',(row.amount/100).toFixed(2),'required min="0.01" max="100000000" step="0.01"'),
    payload:values=>({...values,amount:cents(values.amount)}),
  },
  budgets:{
    title:'My monthly budgets',singular:'budget',
    columns:[['id','ID'],['category','Category'],['amount','Monthly limit']],
    format:(name,row)=>name==='amount'?money(row.amount):undefined,
    fields:row=>field('category','Category','text',row.category,'required maxlength="40"')+
      field('amount','Monthly limit (₱)','number',(row.amount/100).toFixed(2),'required min="0.01" max="100000000" step="0.01"'),
    payload:values=>({...values,amount:cents(values.amount)}),
  },
  buckets:{
    title:'My wallet buckets',singular:'wallet bucket',
    columns:[['id','ID'],['name','Name'],['category','Category'],['amount','Set aside'],['target','Goal']],
    format:(name,row)=>['amount','target'].includes(name)?money(row[name]):undefined,
    fields:row=>field('name','Bucket name','text',row.name,'required maxlength="60"')+
      field('category','Category','text',row.category,'required maxlength="40"')+
      field('amount','Set aside (₱)','number',(row.amount/100).toFixed(2),'required min="0" max="100000000" step="0.01"')+
      field('target','Goal (₱)','number',(row.target/100).toFixed(2),'required min="0.01" max="100000000" step="0.01"'),
    payload:values=>({...values,amount:cents(values.amount),target:cents(values.target)}),
  },
};
