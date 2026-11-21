import base64
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient
from test_app import env, account, tx

IMAGE=b'\x89PNG\r\n\x1a\nsynthetic-unit-fixture'


PREVIEW_EMAIL='owner@example.com'


def wallet_user(env):
    return account(env)


def create_account(c,provider='GCash',amount=100000,funding='new',key=None):
    return c.post('/api/wallet-accounts',json={'provider':provider,'amount':amount,'funding':funding,'request_id':key or provider+'-account-request-0001'})


def wallet_id(c): return c.get('/api/state').json()['wallet_accounts'][0]['id']


@pytest.fixture
def scanner(env,monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY','test-only-secret')
    monkeypatch.setenv('GEMINI_MODEL','test-image-model')
    calls=[]
    analysis={'is_receipt':True,'currency':'PHP','amount':12345,'description':'Cafe lunch','category':'Food','receipt_date':str(date.today())}
    def generate(url,**kwargs):
        calls.append((url,kwargs))
        return httpx.Response(200,json={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(analysis)}]}}]})
    monkeypatch.setattr(env.receipts.httpx,'post',generate)
    return env,calls,analysis


def scan(c,image=IMAGE): return c.post('/api/receipts/scan',content=image,headers={'Content-Type':'image/png'})


def expense(aid,amount=12345):
    return {'account_id':aid,'amount':amount,'description':'Cafe lunch','category':'Food','date':str(date.today())}


@pytest.mark.parametrize('role',['user','admin'])
def test_wallet_and_receipt_features_are_open_but_user_records_stay_private(scanner,monkeypatch,role):
    env,_,_=scanner
    # Configuring the old reserved login must not restrict everyone else's access.
    monkeypatch.setattr(env,'WALLET_PREVIEW_EMAIL',PREVIEW_EMAIL)
    env.init()
    member=account(env,'member@example.com')
    other=wallet_user(env)
    with env.db() as db:
        db.execute('UPDATE users SET role=? WHERE email=?',(role,'member@example.com'))
    assert create_account(TestClient(env.app)).status_code==401
    assert create_account(other).status_code==200
    assert create_account(member,'Maya').status_code==200
    state=member.get('/api/state').json()
    assert state['user']['wallet_preview'] is True
    assert len(state['wallet_accounts'])==1
    assert state['wallet_accounts'][0]['provider']=='Maya'
    assert state['unassigned_balance']==0
    member_id=wallet_id(member)
    other_id=wallet_id(other)
    assert member.post('/api/transactions',json={**expense(other_id),'kind':'income'}).status_code==404
    other_scan=scan(other)
    assert other_scan.status_code==200
    assert member.post(f"/api/receipts/{other_scan.json()['id']}/confirm",json=expense(member_id)).status_code==404
    result=scan(member)
    assert result.status_code==200
    path=f"/api/receipts/{result.json()['id']}/confirm"
    assert member.post(path,json=expense(other_id)).status_code==404
    assert member.post(path,json=expense(member_id)).status_code==200
    assert member.get('/api/state').json()['balance']==87655
    assert other.get('/api/state').json()['balance']==100000
    expected=200 if role=='admin' else 403
    assert member.get('/api/admin').status_code==expected
    assert member.post('/api/admin/database/unlock',json={'password':'correct-horse-123'}).status_code==expected
    if role=='user':
        assert member.get('/api/admin/database/users').status_code==403
    with env.db() as db:
        db.execute('UPDATE users SET active=0 WHERE email=?',('member@example.com',))
    assert create_account(member,'BPI').status_code==401
    assert scan(member).status_code==401


def test_existing_wallet_accounts_stay_available_without_preview_configuration(env,monkeypatch):
    member=wallet_user(env)
    assert create_account(member,amount=50000).status_code==200
    monkeypatch.setattr(env,'WALLET_PREVIEW_EMAIL','')
    aid=wallet_id(member)
    assert member.post('/api/transactions',json={**expense(aid,20000),'kind':'expense'}).status_code==200
    assert member.post('/api/transactions',json={**expense(aid,30001),'kind':'expense'}).status_code==400
    state=member.get('/api/state').json()
    assert state['balance']==30000 and state['wallet_accounts'][0]['balance']==30000
    assert all(entry['account_id']==aid for entry in state['transactions'])


def test_accounts_new_funds_and_existing_funds_no_double_count(env):
    c=wallet_user(env);tx(c,'income',50000)
    assert create_account(c,amount=20000,funding='existing').status_code==200
    s=c.get('/api/state').json()
    assert s['balance']==50000 and s['unassigned_balance']==30000 and s['wallet_accounts'][0]['balance']==20000
    assert len(s['transactions'])==1
    for _ in range(2): assert create_account(c,'Maya',10000).status_code==200
    s=c.get('/api/state').json()
    assert s['balance']==s['wallet_total']==60000 and len(s['wallet_accounts'])==2
    assert sum(a['balance'] for a in s['wallet_accounts'])+s['unassigned_balance']==s['balance']
    assert create_account(c,'BPI',30001,'existing').status_code==400
    assert create_account(c,'BPI',30000,'existing').status_code==200
    assert c.get('/api/state').json()['unassigned_balance']==0
    for provider in ['UnionBank','Metrobank','BDO','EastWest','RCBC','Security Bank','Other']:
        assert create_account(c,provider,0).status_code==200
    original=c.get('/api/state').json()['transactions'][-1]['id']
    assert c.delete(f'/api/transactions/{original}').status_code==400
    assert create_account(c,amount=1,key='different-request-0001').status_code==409


def test_scan_has_no_balance_effect_and_confirm_posts_one_selected_debit(scanner):
    env,calls,analysis=scanner;c=wallet_user(env)
    create_account(c);create_account(c,'BPI',50000)
    before=c.get('/api/state').json();r=scan(c)
    assert r.status_code==200,r.text
    assert c.get('/api/state').json()==before
    assert r.json()['analysis']==analysis
    url,body=calls[0]
    assert 'test-image-model:generateContent' in url
    assert body['headers']=={'x-goog-api-key':'test-only-secret'}
    parts=body['json']['contents'][0]['parts']
    assert parts[1]['inlineData']=={'mimeType':'image/png','data':base64.b64encode(IMAGE).decode()}
    assert 'responseJsonSchema' in body['json']['generationConfig']
    assert 'one@example.com' not in json.dumps(body['json'])
    aid=wallet_id(c);path=f"/api/receipts/{r.json()['id']}/confirm"
    for _ in range(2): assert c.post(path,json=expense(aid)).status_code==200
    s=c.get('/api/state').json()
    assert s['wallet_accounts'][0]['balance']==87655 and s['wallet_accounts'][1]['balance']==50000
    assert s['balance']==s['wallet_total']==s['unallocated']==137655
    receipt_tx=[t for t in s['transactions'] if t['source']=='receipt']
    assert len(receipt_tx)==1 and receipt_tx[0]['account_id']==aid
    assert c.post(path,json=expense(aid,12346)).status_code==409
    assert scan(c).status_code==409
    assert len(calls)==1
    assert c.delete(f"/api/transactions/{receipt_tx[0]['id']}").status_code==400


def test_receipt_account_ownership_reserves_and_insufficient_funds(scanner):
    env,calls,_=scanner;c=wallet_user(env);other=account(env,'other@example.com')
    create_account(c,amount=10000);create_account(c,'Maya',100000)
    with env.db() as db:
        other_uid=db.execute('SELECT id FROM users WHERE email=?',('other@example.com',)).fetchone()[0]
        foreign_id=db.execute("INSERT INTO wallet_accounts(user_id,provider,name) VALUES(?,'BPI','Legacy BPI')",(other_uid,)).lastrowid
    rid=scan(c).json()['id'];path=f'/api/receipts/{rid}/confirm'
    assert other.post(path,json=expense(foreign_id)).status_code==404
    assert c.post(path,json=expense(foreign_id)).status_code==404
    assert c.post(path,json=expense(wallet_id(c))).status_code==400
    assert c.post('/api/buckets',json={'name':'Savings','category':'Savings','amount':109000,'target':120000}).status_code==200
    maya=c.get('/api/state').json()['wallet_accounts'][1]['id']
    assert c.post(path,json=expense(maya)).status_code==400
    assert c.get('/api/state').json()['balance']==110000
    assert c.post(path,json={**expense(maya),'amount':-1}).status_code==422
    assert c.post(path,json={**expense(maya),'amount':123.45}).status_code==422
    assert c.post(path,json={**expense(maya),'account_id':None}).status_code==422
    assert c.post(path,json={**expense(maya),'kind':'income'}).status_code==422
    assert c.post(path,json={**expense(maya),'date':'2999-01-01'}).status_code==422
    assert c.post(path,headers={'Origin':'https://other.example'},json=expense(maya)).status_code==403


def test_receipt_concurrent_confirmations_deduct_once(scanner):
    env,_,_=scanner;c=wallet_user(env);create_account(c)
    rid=scan(c).json()['id'];aid=wallet_id(c)
    def save(_):
        client=TestClient(env.app);client.cookies.update(c.cookies)
        return client.post(f'/api/receipts/{rid}/confirm',json=expense(aid)).status_code
    with ThreadPoolExecutor(max_workers=2) as pool: assert list(pool.map(save,range(2)))==[200,200]
    assert c.get('/api/state').json()['balance']==87655


def test_pending_receipt_retry_reuses_analysis_and_user_can_correct_it(scanner):
    env,calls,analysis=scanner;c=wallet_user(env);create_account(c)
    analysis.update(amount=None,receipt_date=None,currency='UNKNOWN')
    r=scan(c);assert r.status_code==200
    assert scan(c).json()==r.json() and len(calls)==1
    assert c.post(f"/api/receipts/{r.json()['id']}/confirm",json=expense(wallet_id(c),20000)).status_code==200
    assert c.get('/api/state').json()['balance']==80000


def test_scan_requires_login_account_valid_image_and_bounded_upload(scanner):
    env,calls,_=scanner
    assert scan(TestClient(env.app)).status_code==401
    c=wallet_user(env)
    assert scan(c).status_code==400
    create_account(c)
    assert scan(c,b'<svg>not a photo</svg>').status_code==415
    assert scan(c,IMAGE+b'0'*(5*1024*1024)).status_code==413
    assert not calls


@pytest.mark.parametrize('updates',[{'is_receipt':False},{'currency':'OTHER'},{'amount':-1},{'amount':123.45},{'category':'<script>'},{'amount':'9999'}])
def test_scan_rejects_unsafe_or_invalid_extraction(scanner,updates):
    env,_,analysis=scanner;c=wallet_user(env);create_account(c)
    analysis.update(updates)
    assert scan(c).status_code==422
    assert c.get('/api/state').json()['balance']==100000
    with env.db() as db: assert db.execute('SELECT count(*) FROM receipt_scans').fetchone()[0]==0


@pytest.mark.parametrize('status,expected',[(400,503),(403,503),(429,429),(500,503)])
def test_provider_failures_never_deduct_or_leak_keys(scanner,monkeypatch,status,expected):
    env,_,_=scanner;c=wallet_user(env);create_account(c)
    monkeypatch.setattr(env.receipts.httpx,'post',lambda *a,**kw:httpx.Response(status,json={'secret':'test-only-secret'}))
    r=scan(c)
    assert r.status_code==expected and 'test-only-secret' not in r.text
    assert c.get('/api/state').json()['balance']==100000


def test_provider_timeout_and_malformed_output(scanner,monkeypatch):
    env,_,_=scanner;c=wallet_user(env);create_account(c)
    def timeout(*a,**kw): raise httpx.ReadTimeout('secret')
    monkeypatch.setattr(env.receipts.httpx,'post',timeout)
    assert scan(c).status_code==504
    monkeypatch.setattr(env.receipts.httpx,'post',lambda *a,**kw:httpx.Response(200,json={'candidates':[]}))
    assert scan(c).status_code==422
    assert c.get('/api/state').json()['balance']==100000


def test_ai_quota_shared_between_chat_and_receipt_scans(scanner):
    env,calls,_=scanner;c=wallet_user(env);create_account(c)
    uid=c.get('/api/state').json()['user']['id']
    with env.db() as db:
        db.executemany('INSERT INTO ai_requests VALUES(?,?)',[(uid,env.time.time())]*5)
    assert scan(c).status_code==429
    assert not calls


def test_manual_and_shared_expenses_respect_selected_account(env):
    a,b=wallet_user(env),account(env,'other@example.com')
    create_account(a,amount=10000);create_account(a,'BPI',50000);tx(b,'income',10000)
    aid=wallet_id(a)
    # Unassigned money cannot silently spend a named account.
    assert tx(a,'expense',1).status_code==400
    assert a.post('/api/transactions',json={**expense(aid,10001),'kind':'expense'}).status_code==400
    assert a.post('/api/transactions',json={**expense(aid,1000),'kind':'expense'}).status_code==200
    income={**expense(aid,1000),'kind':'income'}
    assert a.post('/api/transactions',json=income).status_code==200
    a.post('/api/groups',json={'name':'Dinner','description':''})
    g=a.get('/api/state').json()['groups'][0];b.post('/api/groups/join',json={'code':g['code']})
    auid=a.get('/api/state').json()['user']['id'];buid=b.get('/api/state').json()['user']['id']
    shared={'description':'Dinner','amount':10000,'participants':[auid,buid],'account_id':aid}
    assert a.post(f"/api/groups/{g['id']}/expenses",json=shared).status_code==200
    assert b.post(f"/api/groups/{g['id']}/payments",json={'receiver':auid,'amount':5000}).status_code==200
    s=a.get('/api/state').json()
    assert s['wallet_accounts'][0]['balance']==0 and s['unassigned_balance']==5000
    assert b.get('/api/state').json()['balance']==5000
    # Income cannot be deleted if it would overdraw that account, even if another has funds.
    tid=next(t['id'] for t in s['transactions'] if t['description']=='Cafe lunch' and t['kind']=='income')
    assert a.delete(f'/api/transactions/{tid}').status_code==400
