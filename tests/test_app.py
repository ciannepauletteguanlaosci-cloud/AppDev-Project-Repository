import importlib
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient

@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv('PENNY_DB',str(tmp_path/'test.db'))
    from app import main
    importlib.reload(main)
    return main

def account(env,email='one@example.com'):
    c=TestClient(env.app)
    r=c.post('/api/register',json={'email':email,'password':'correct-horse-123','name':email.split('@')[0]})
    assert r.status_code==200,r.text
    return c

def tx(c,kind,amount,days=0):
    return c.post('/api/transactions',json={'kind':kind,'amount':amount,'category':'Food','description':'Lunch','date':str(date.today()-timedelta(days=days))})

def test_login_lockout_logout(env):
    c=account(env)
    c.post('/api/logout')
    assert c.get('/api/state').status_code==401
    for _ in range(5):
        assert c.post('/api/login',json={'email':'one@example.com','password':'incorrect'}).status_code==401
    assert c.post('/api/login',json={'email':'one@example.com','password':'correct-horse-123'}).status_code==429
    with env.db() as db: db.execute('UPDATE users SET locked=1')
    assert c.post('/api/login',json={'email':'one@example.com','password':'correct-horse-123'}).status_code==200
    assert c.get('/api/state').status_code==200

@pytest.mark.parametrize('remember,days', [(False,7),(True,30)])
def test_remembered_session_expiry_and_persistent_account(env,remember,days):
    credentials={'email':'remember@example.com','password':'correct-horse-123','remember_me':remember}
    c=TestClient(env.app)
    response=c.post('/api/register',json=credentials)
    assert response.status_code==200
    assert f'Max-Age={days*86400}' in response.headers['set-cookie']
    assert 'HttpOnly' in response.headers['set-cookie']
    token=c.cookies.get('penny_session')
    digest=env.hashlib.sha256(token.encode()).hexdigest()
    with env.db() as db:
        stored=db.execute('SELECT password FROM users WHERE email=?',(credentials['email'],)).fetchone()[0]
        expires=db.execute('SELECT expires FROM sessions WHERE token=?',(digest,)).fetchone()[0]
    assert stored!=credentials['password']
    assert env.hmac.compare_digest(stored,env.password_hash(credentials['password'],stored.split(':')[0]))
    assert abs(expires-env.time.time()-days*86400)<5
    # A new app instance using the same database keeps both account and session.
    importlib.reload(env)
    reopened=TestClient(env.app)
    reopened.cookies.set('penny_session',token)
    assert reopened.get('/api/state').status_code==200
    assert reopened.post('/api/register',json=credentials).status_code==409
    with env.db() as db:
        db.execute('UPDATE sessions SET expires=? WHERE token=?',(env.time.time()-1,digest))
    assert reopened.get('/api/state').status_code==401
    # Expiration requires sign-in, never another registration.
    signed_in=reopened.post('/api/login',json=credentials)
    assert signed_in.status_code==200
    assert f'Max-Age={days*86400}' in signed_in.headers['set-cookie']
    assert reopened.get('/api/state').status_code==200
    current_token=next(cookie.value for cookie in reopened.cookies.jar if cookie.domain=='testserver.local' and cookie.name=='penny_session')
    assert reopened.post('/api/logout').status_code==200
    replay=TestClient(env.app)
    replay.cookies.set('penny_session',current_token)
    assert replay.get('/api/state').status_code==401

def test_disabling_account_revokes_remembered_session(env):
    admin=account(env)
    member=TestClient(env.app)
    assert member.post('/api/register',json={'email':'member@example.com','password':'correct-horse-123','remember_me':True}).status_code==200
    uid=member.get('/api/state').json()['user']['id']
    with env.db() as db:
        db.execute("UPDATE users SET role='admin' WHERE email='one@example.com'")
    assert admin.put(f'/api/admin/users/{uid}',json={'active':False}).status_code==200
    assert member.get('/api/state').status_code==401
    assert admin.put(f'/api/admin/users/{uid}',json={'active':True}).status_code==200
    assert member.get('/api/state').status_code==401

def test_wallet_integrity_and_ownership(env):
    c=account(env); other=account(env,'two@example.com')
    assert tx(c,'income',10000).status_code==200
    bucket={'name':'Reserve','category':'Savings','amount':8000,'target':12000}
    assert c.post('/api/buckets',json=bucket).status_code==200
    bid=c.get('/api/state').json()['buckets'][0]['id']
    assert tx(c,'expense',2001).status_code==400
    assert tx(c,'expense',2000).status_code==200
    assert c.post('/api/buckets',json=bucket).status_code==400
    assert other.put(f'/api/buckets/{bid}',json=bucket).status_code==404
    assert other.get('/api/state').json()['transactions']==[]
    assert c.put(f'/api/buckets/{bid}',json={**bucket,'amount':4000}).status_code==200
    s=c.get('/api/state').json()
    assert s['balance']==8000 and s['unallocated']==4000
    iid=next(t['id'] for t in s['transactions'] if t['kind']=='income')
    assert c.delete(f'/api/transactions/{iid}').status_code==400
    assert c.delete(f'/api/buckets/{bid}').status_code==200
    assert c.get('/api/state').json()['unallocated']==8000
    assert tx(c,'expense',-1).status_code==422
    assert tx(c,'expense',1.5).status_code==422

def test_shared_splits_membership_and_settlement(env):
    a=account(env); b=account(env,'two@example.com'); outsider=account(env,'three@example.com')
    tx(a,'income',20000); tx(b,'income',20000)
    a.post('/api/groups',json={'name':'Dorm','description':'Utilities'})
    g=a.get('/api/state').json()['groups'][0]; gid=g['id']
    bid=b.get('/api/state').json()['user']['id']; aid=a.get('/api/state').json()['user']['id']
    assert b.post('/api/groups/join',json={'code':g['code']}).status_code==200
    payload={'description':'Dinner','amount':10001,'participants':[aid,bid]}
    assert outsider.post(f'/api/groups/{gid}/expenses',json=payload).status_code==404
    assert a.post(f'/api/groups/{gid}/expenses',json={**payload,'shares':[5000,5000]}).status_code==400
    assert a.post(f'/api/groups/{gid}/expenses',json=payload).status_code==200
    g=a.get('/api/state').json()['groups'][0]
    balances={m['id']:m['balance'] for m in g['members']}
    assert balances=={aid:5000,bid:-5000}
    assert b.post(f'/api/groups/{gid}/payments',json={'receiver':aid,'amount':5001}).status_code==400
    assert b.post(f'/api/groups/{gid}/payments',json={'receiver':aid,'amount':5000}).status_code==200
    assert all(m['balance']==0 for m in a.get('/api/state').json()['groups'][0]['members'])
    assert b.post(f'/api/groups/{gid}/payments',json={'receiver':aid,'amount':1}).status_code==400

def test_forecast_and_budget_updates(env):
    c=account(env)
    assert not c.get('/api/state').json()['forecast']['ready']
    tx(c,'income',1000000)
    for d in [0,1,2,3,4]: assert tx(c,'expense',10000,d).status_code==200
    c.post('/api/budgets',json={'category':'Food','amount':50000})
    f=c.get('/api/state').json()['forecast']
    assert f['ready'] and f['projected']==round(50000/7*30)
    assert f['categories'][0]['projected']>f['categories'][0]['budget']
    c.post('/api/budgets',json={'category':'Food','amount':300000})
    s=c.get('/api/state').json()
    assert len(s['budgets'])==1 and s['forecast']['categories'][0]['budget']==300000

def test_admin_and_cross_origin(env):
    a=account(env); b=account(env,'two@example.com')
    assert a.get('/api/admin').status_code==403
    with env.db() as db: db.execute("UPDATE users SET role='admin' WHERE email='one@example.com'")
    assert b.post('/api/concerns',json={'message':'Unable to access my record'}).status_code==200
    s=a.get('/api/admin').json(); uid=next(u['id'] for u in s['users'] if u['email']=='two@example.com')
    assert a.post(f"/api/admin/concerns/{s['concerns'][0]['id']}/resolve").status_code==200
    assert a.put(f'/api/admin/users/{uid}',json={'active':False}).status_code==200
    assert b.get('/api/state').status_code==401
    assert a.post('/api/transactions',headers={'Origin':'https://other.example'},json={}).status_code==403

def test_demo_and_static_assets(env):
    a=account(env)
    assert a.post('/api/demo').status_code==200
    s=a.get('/api/state').json()
    assert s['unallocated']>=0 and len(s['buckets'])==3
    assert a.post('/api/demo').status_code==400
    assert a.get('/').status_code==200
    assert a.get('/static/app.js').status_code==200
