from concurrent.futures import ThreadPoolExecutor
import importlib
from fastapi.testclient import TestClient
from test_app import env, account, tx


def group(env):
    a,b=account(env),account(env,'two@example.com')
    tx(a,'income',20000); tx(b,'income',10000)
    a.post('/api/groups',json={'name':'Dinner club','description':''})
    g=a.get('/api/state').json()['groups'][0]
    b.post('/api/groups/join',json={'code':g['code']})
    aid=a.get('/api/state').json()['user']['id']; bid=b.get('/api/state').json()['user']['id']
    expense={'description':'Dinner','amount':10000,'participants':[aid,bid],'request_id':'expense-request-0001'}
    payment={'receiver':aid,'amount':5000,'request_id':'payment-request-0001'}
    return a,b,g['id'],expense,payment


def test_shared_wallet_posts_full_expense_and_both_payment_sides_once(env):
    a,b,gid,expense,payment=group(env)
    for _ in range(2): assert a.post(f'/api/groups/{gid}/expenses',json=expense).status_code==200
    s=a.get('/api/state').json()
    assert s['balance']==s['wallet_total']==s['unallocated']==10000
    assert len(s['groups'][0]['expenses'])==1
    assert s['groups'][0]['expenses'][0]['wallet_posted']
    assert b.get('/api/state').json()['balance']==10000
    for _ in range(2): assert b.post(f'/api/groups/{gid}/payments',json=payment).status_code==200
    astate=a.get('/api/state').json(); bstate=b.get('/api/state').json()
    assert astate['balance']==astate['wallet_total']==15000
    assert bstate['balance']==bstate['wallet_total']==5000
    assert len(astate['groups'][0]['payments'])==1
    assert astate['groups'][0]['payments'][0]['wallet_posted']
    assert all(m['balance']==0 for m in astate['groups'][0]['members'])
    assert [t['kind'] for t in astate['transactions'] if t['source']=='shared_payment']==['income']
    assert [t['kind'] for t in bstate['transactions'] if t['source']=='shared_payment']==['expense']
    for client,state in ((a,astate),(b,bstate)):
        for t in state['transactions']:
            if t['source']: assert client.delete(f"/api/transactions/{t['id']}").status_code==400
    assert b.post(f'/api/groups/{gid}/payments',json={**payment,'amount':100}).status_code==409
    assert a.post(f'/api/groups/{gid}/expenses',json={**expense,'amount':200}).status_code==409


def test_shared_wallet_protects_bucket_funds_and_rolls_back_failed_requests(env):
    a,b,gid,expense,payment=group(env)
    bucket={'name':'Savings','category':'Savings','amount':15000,'target':20000}
    a.post('/api/buckets',json=bucket)
    assert a.post(f'/api/groups/{gid}/expenses',json=expense).status_code==400
    assert a.get('/api/state').json()['groups'][0]['expenses']==[]
    a.delete('/api/buckets/'+str(a.get('/api/state').json()['buckets'][0]['id']))
    assert a.post(f'/api/groups/{gid}/expenses',json=expense).status_code==200
    b.post('/api/buckets',json={**bucket,'amount':6000})
    assert b.post(f'/api/groups/{gid}/payments',json=payment).status_code==400
    assert a.get('/api/state').json()['balance']==10000
    assert b.get('/api/state').json()['groups'][0]['payments']==[]
    b.delete('/api/buckets/'+str(b.get('/api/state').json()['buckets'][0]['id']))
    assert b.post(f'/api/groups/{gid}/payments',json=payment).status_code==200


def test_payment_atomic_on_receiver_post_failure(env,monkeypatch):
    a,b,gid,expense,payment=group(env)
    a.post(f'/api/groups/{gid}/expenses',json=expense)
    real=env.post_shared_wallet
    def fail_credit(c,uid,kind,*args):
        if kind=='income': raise RuntimeError('Simulated storage failure')
        return real(c,uid,kind,*args)
    monkeypatch.setattr(env,'post_shared_wallet',fail_credit)
    client=TestClient(env.app,raise_server_exceptions=False);client.cookies.update(b.cookies)
    assert client.post(f'/api/groups/{gid}/payments',json=payment).status_code==500
    assert a.get('/api/state').json()['balance']==10000
    assert b.get('/api/state').json()['balance']==10000
    assert b.get('/api/state').json()['groups'][0]['payments']==[]
    monkeypatch.setattr(env,'post_shared_wallet',real)
    assert b.post(f'/api/groups/{gid}/payments',json=payment).status_code==200


def test_concurrent_retries_have_one_effect(env):
    a,b,gid,expense,payment=group(env)
    def send(client,path,body):
        c=TestClient(env.app);c.cookies.update(client.cookies)
        return c.post(path,json=body).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda _:send(a,f'/api/groups/{gid}/expenses',expense),range(2)))==[200,200]
        assert list(pool.map(lambda _:send(b,f'/api/groups/{gid}/payments',payment),range(2)))==[200,200]
    assert a.get('/api/state').json()['balance']==15000
    assert b.get('/api/state').json()['balance']==5000


def test_old_shared_records_are_not_reposted_during_migration(env):
    a,b,gid,expense,payment=group(env)
    aid,bid=expense['participants']
    with env.db() as c:
        eid=c.execute('INSERT INTO shared_expenses(group_id,payer,description,amount) VALUES(?,?,?,?)',(gid,aid,'Old dinner',10000)).lastrowid
        c.executemany('INSERT INTO shares VALUES(?,?,?)',[(eid,aid,5000),(eid,bid,5000)])
        c.execute('INSERT INTO payments(group_id,sender,receiver,amount) VALUES(?,?,?,?)',(gid,bid,aid,5000))
    importlib.reload(env)
    s=a.get('/api/state').json()
    assert s['balance']==20000
    assert not s['groups'][0]['expenses'][0]['wallet_posted']
    assert not s['groups'][0]['payments'][0]['wallet_posted']
    assert b.get('/api/state').json()['balance']==10000


def test_disabled_receiver_and_outsider_cannot_receive_shared_payment(env):
    a,b,gid,expense,payment=group(env)
    a.post(f'/api/groups/{gid}/expenses',json=expense)
    outsider=account(env,'outsider@example.com')
    oid=outsider.get('/api/state').json()['user']['id']
    assert b.post(f'/api/groups/{gid}/payments',json={**payment,'receiver':oid}).status_code==404
    assert outsider.post(f'/api/groups/{gid}/payments',json=payment).status_code==404
    with env.db() as c: c.execute('UPDATE users SET active=0 WHERE id=?',(payment['receiver'],))
    assert b.post(f'/api/groups/{gid}/payments',json=payment).status_code==400
    assert b.get('/api/state').json()['balance']==10000
