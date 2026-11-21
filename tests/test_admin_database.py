import time

from fastapi.testclient import TestClient

from test_app import account, env, tx

ROOT='/api/admin/database'
PASSWORD='correct-horse-123'


def admin_client(env):
    client=account(env,'admin@example.com')
    with env.db() as c:
        c.execute("UPDATE users SET role='admin' WHERE email=?",('admin@example.com',))
    return client


def unlock(client):
    result=client.post(ROOT+'/unlock',json={'password':PASSWORD})
    assert result.status_code==200,result.text
    return {'X-Database-Key':result.json()['key']}


def test_database_requires_admin_password_for_each_session(env):
    admin=admin_client(env)
    member=account(env)
    assert member.post(ROOT+'/unlock',json={'password':PASSWORD}).status_code==403
    assert admin.get(ROOT+'/users').status_code==423
    assert admin.put(ROOT+'/users/1',json={'name':'Changed','revision':'0'*64}).status_code==423
    assert admin.post(ROOT+'/unlock',json={'password':'bad'}).status_code==403
    headers=unlock(admin)
    second=TestClient(env.app)
    second.post('/api/login',json={'email':'admin@example.com','password':PASSWORD})
    assert second.get(ROOT+'/users',headers=headers).status_code==423
    assert admin.get(ROOT+'/users',headers=headers).status_code==200
    assert admin.post(ROOT+'/lock',headers=headers).status_code==200
    assert admin.get(ROOT+'/users',headers=headers).status_code==423
    headers=unlock(admin)
    with env.db() as c: c.execute('UPDATE database_grants SET expires=?',(time.time()-1,))
    assert admin.get(ROOT+'/users',headers=headers).status_code==423
    unlock(admin)
    admin.post('/api/logout')
    with env.db() as c: assert c.execute('SELECT count(*) FROM database_grants').fetchone()[0]==0


def test_database_search_save_conflict_and_private_transactions(env):
    admin=admin_client(env)
    member=account(env,'member@example.com')
    tx(member,'income',10000)
    tx(admin,'income',50000)
    tx(admin,'expense',10000)
    headers=unlock(admin)
    def rows(table,query=''):
        return admin.get(ROOT+'/'+table,params={'q':query},headers=headers).json()['rows']
    def save(table,row,values):
        return admin.put(f"{ROOT}/{table}/{row['id']}",headers=headers,json={'revision':row['revision'],**values})
    user,=rows('users','member@')
    assert set(user)=={'id','name','email','role','active','revision'}
    assert save('users',user,{'name':'Taylor'}).status_code==200
    assert save('users',user,{'name':'Older edit'}).status_code==409
    assert member.get('/api/state').json()['user']['name']=='Taylor'
    member.post('/api/concerns',json={'message':'Please help me find my records.'})
    issue,=rows('concerns','find my records')
    assert save('concerns',issue,{'reply':'Open Transactions.','status':'resolved'}).status_code==200
    assert member.get('/api/concerns').json()['concerns'][0]['reply']=='Open Transactions.'
    entries=rows('transactions')
    assert len(entries)==2
    cost=next(row for row in entries if row['kind']=='expense')
    edit={k:cost[k] for k in ('date','kind','description','category','amount')}
    assert save('transactions',cost,{**edit,'amount':51000}).status_code==400
    assert save('transactions',cost,{**edit,'amount':2500}).status_code==200
    assert admin.get('/api/state').json()['balance']==47500
    assert member.get('/api/state').json()['balance']==10000
    assert admin.get(ROOT+'/sessions',headers=headers).status_code==422


def test_database_profile_changes_revoke_access_and_protect_identity(env,monkeypatch):
    admin=admin_client(env)
    member=account(env,'member@example.com')
    headers=unlock(admin)
    admin_id=admin.get('/api/state').json()['user']['id']
    uid=member.get('/api/state').json()['user']['id']

    def row(rid):
        return admin.get(ROOT+'/users',params={'q':str(rid)},headers=headers).json()['rows'][0]

    def edit(original,**fields):
        return admin.put(f"{ROOT}/users/{original['id']}",headers=headers,
                         json={'name':original['name'],'revision':original['revision'],**fields})

    self_row=row(admin_id)
    assert edit(self_row,role='user').status_code==400
    assert edit(self_row,active=False).status_code==400
    original=row(uid)
    assert edit(original,email='admin@example.com').status_code==409
    assert edit(original,email='invalid').status_code==422
    monkeypatch.setattr(env,'WALLET_PREVIEW_EMAIL','member@example.com')
    assert edit(original,email='renamed@example.com').status_code==400
    monkeypatch.setattr(env,'WALLET_PREVIEW_EMAIL','reserved@example.com')
    assert edit(original,email='reserved@example.com').status_code==400
    env.create_reset_code(uid)
    assert edit(original,email=' Renamed@example.com ',role='admin',active=False).status_code==200
    assert member.get('/api/state').status_code==401
    with env.db() as c:
        assert not c.execute('SELECT 1 FROM password_resets WHERE user_id=?',(uid,)).fetchone()
    locked=row(uid)
    assert (locked['email'],locked['role'],locked['active'])==('renamed@example.com','admin',0)
    assert edit(original,name='Stale').status_code==409
    assert edit(locked,role='user').status_code==400
    assert edit(locked,role='user',active=True).status_code==200
    assert member.post('/api/login',json={'email':'member@example.com','password':PASSWORD}).status_code==401
    assert member.post('/api/login',json={'email':'renamed@example.com','password':PASSWORD}).status_code==200
    assert edit(self_row,email='new-admin@example.com').json()['sign_in_required'] is True
    assert admin.get(ROOT+'/users',headers=headers).status_code==401


def test_database_budgets_and_buckets_keep_owner_and_funding_rules(env):
    admin=admin_client(env)
    other=account(env)
    headers=unlock(admin)
    tx(admin,'income',20000)
    tx(other,'income',20000)
    bucket={'name':'Tuition','category':'School','amount':5000,'target':15000}
    for client in (admin,other):
        assert client.post('/api/buckets',json=bucket).status_code==200
        assert client.post('/api/budgets',json={'category':'Food','amount':10000}).status_code==200
    assert admin.post('/api/budgets',json={'category':'Rent','amount':40000}).status_code==200

    def rows(table,query):
        return admin.get(ROOT+'/'+table,headers=headers,params={'q':query}).json()['rows']

    def save(table,row,fields,rid=None):
        return admin.put(f"{ROOT}/{table}/{rid or row['id']}",headers=headers,
                         json={**fields,'revision':row['revision']})

    plan,=rows('budgets','Food')
    budget_edit={'category':'Travel','amount':8300}
    assert save('budgets',plan,{**budget_edit,'category':'Rent'}).status_code==409
    assert save('budgets',plan,budget_edit,other.get('/api/state').json()['budgets'][0]['id']).status_code==404
    assert save('budgets',plan,budget_edit).status_code==200
    assert save('budgets',plan,budget_edit).status_code==409
    assert rows('budgets','Travel')[0]['amount']==8300

    old,=rows('buckets','Tuition')
    bucket_edit={**bucket,'name':'Next term','amount':12000,'target':26000}
    assert save('buckets',old,{**bucket_edit,'amount':20001}).status_code==400
    assert save('buckets',old,bucket_edit,other.get('/api/state').json()['buckets'][0]['id']).status_code==404
    assert save('buckets',old,bucket_edit).status_code==200
    assert save('buckets',old,bucket_edit).status_code==409
    assert admin.get('/api/state').json()['unallocated']==8000
    assert other.get('/api/state').json()['unallocated']==15000
