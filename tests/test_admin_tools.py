import time
from test_app import env, account


def admin_pair(env):
    a,b=account(env),account(env,'member@example.com')
    aid=a.get('/api/state').json()['user']['id']; bid=b.get('/api/state').json()['user']['id']
    with env.db() as c: c.execute("UPDATE users SET role='admin' WHERE id=?",(aid,))
    return a,b,aid,bid


def login(c):
    return c.post('/api/login',json={'email':'member@example.com','password':'correct-horse-123'})


def test_admin_controls_enforce_roles_and_revoke_sessions(env):
    a,b,aid,bid=admin_pair(env)
    for path,method,body in [(f'users/{aid}/role','put',{'role':'user'}),(f'users/{aid}/sign-out','post',{}),(f'users/{aid}/unlock','post',{}),('concerns/1','put',{'status':'resolved'})]:
        assert getattr(b,method)('/api/admin/'+path,json=body).status_code==403
    assert a.put(f'/api/admin/users/{aid}/role',json={'role':'user'}).status_code==400
    assert a.put(f'/api/admin/users/{aid}',json={'active':False}).status_code==400
    assert a.post('/api/admin/users/9999/unlock').status_code==404
    assert a.put(f'/api/admin/users/{bid}/role',json={'role':'admin'}).status_code==200
    assert b.get('/api/state').status_code==401
    assert login(b).status_code==200
    assert b.get('/api/admin').status_code==200
    assert a.put(f'/api/admin/users/{bid}/role',json={'role':'user'}).status_code==200
    assert b.get('/api/state').status_code==401
    assert login(b).status_code==200
    assert b.get('/api/admin').status_code==403
    assert a.post(f'/api/admin/users/{bid}/sign-out').status_code==200
    assert b.get('/api/state').status_code==401
    with env.db() as c: c.execute('UPDATE users SET failed=5,locked=? WHERE id=?',(time.time()+900,bid))
    assert login(b).status_code==429
    assert a.post(f'/api/admin/users/{bid}/unlock').status_code==200
    assert login(b).status_code==200
    assert a.put(f'/api/admin/users/{bid}',json={'active':False}).status_code==200
    assert a.put(f'/api/admin/users/{bid}/role',json={'role':'admin'}).status_code==400
    assert a.post(f'/api/admin/users/{bid}/unlock').status_code==400
    assert a.put(f'/api/admin/users/{bid}',json={'active':True}).status_code==200
    s=a.get('/api/admin').json()
    assert s['stats']['active_users']==2 and s['stats']['admins']==1
    assert len(s['audit'])==6
    assert {r['action'] for r in s['audit']}=={'role_changed','sessions_revoked','login_unlocked','account_enabled','account_disabled'}
    assert all(r['actor_id']==aid for r in s['audit'])
    assert all('password' not in u and 'balance' not in u for u in s['users'])
    assert all(type(v)==bool for v in s['services'].values())


def test_concern_replies_are_visible_only_to_reporter_and_admin(env):
    a,b,aid,bid=admin_pair(env)
    outsider=account(env,'outsider@example.com')
    assert b.post('/api/concerns',json={'message':'My balance needs a review'}).status_code==200
    s=a.get('/api/admin').json(); concern=s['concerns'][0]; rid=concern['id']
    assert s['stats']['open_concerns']==1
    assert concern['reporter']=='member' and concern['reporter_email']=='member@example.com'
    body={'status':'in_progress','reply':'Please open Shared budgets and review the payment.'}
    assert b.put(f'/api/admin/concerns/{rid}',json=body).status_code==403
    assert a.put(f'/api/admin/concerns/{rid}',json=body).status_code==200
    mine=b.get('/api/concerns').json()['concerns'][0]
    assert mine['reply']==body['reply'] and mine['status']=='in_progress' and mine['updated']>0
    assert outsider.get('/api/concerns').json()=={'concerns':[]}
    assert a.put(f'/api/admin/concerns/{rid}',json={**body,'status':'resolved'}).status_code==200
    assert a.get('/api/admin').json()['stats']['open_concerns']==0
    assert a.put(f'/api/admin/concerns/{rid}',json={**body,'status':'open'}).status_code==200
    assert a.get('/api/admin').json()['stats']['open_concerns']==1
    assert a.put('/api/admin/concerns/9999',json=body).status_code==404
    assert a.post('/api/admin/concerns/9999/resolve').status_code==404
    assert a.put(f'/api/admin/concerns/{rid}',json={**body,'status':'unknown'}).status_code==422


def test_reset_audit_never_contains_code(env):
    a,b,aid,bid=admin_pair(env)
    result=a.post(f'/api/admin/users/{bid}/reset-code')
    assert result.status_code==200
    s=a.get('/api/admin')
    assert result.json()['code'] not in s.text
    assert s.json()['audit'][0]['action']=='reset_code_issued'
