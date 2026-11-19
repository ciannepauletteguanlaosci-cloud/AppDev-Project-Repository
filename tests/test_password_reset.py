import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from test_app import account, env, tx


@pytest.fixture
def recovery(env):
    admin = account(env)
    user = account(env, 'member@example.com')
    with env.db() as c:
        c.execute("UPDATE users SET role='admin' WHERE email='one@example.com'")
    uid = user.get('/api/state').json()['user']['id']
    return env, admin, user, uid


def issue(admin, uid):
    response = admin.post(f'/api/admin/users/{uid}/reset-code', json={})
    assert response.status_code == 200
    assert response.json()['expires_in_seconds'] == 900
    return response.json()['code']


def payload(code, email='member@example.com', password='new-private-password'):
    return {'email': email, 'code': code, 'password': password, 'confirm_password': password}


def test_reset_requires_admin_to_issue_code(recovery):
    env, admin, user, uid = recovery
    path = f'/api/admin/users/{uid}/reset-code'
    assert TestClient(env.app).post(path, json={}).status_code == 401
    assert user.post(path, json={}).status_code == 403
    aid = admin.get('/api/state').json()['user']['id']
    assert admin.post(f'/api/admin/users/{aid}/reset-code', json={}).status_code == 400
    assert admin.post('/api/admin/users/99999/reset-code', json={}).status_code == 404
    assert admin.post(path, json={}, headers={'Origin': 'https://evil.example'}).status_code == 403


def test_reset_updates_hash_preserves_records_and_revokes_all_sessions(recovery):
    env, admin, user, uid = recovery
    other_device = TestClient(env.app)
    assert other_device.post('/api/login', json={'email': 'member@example.com', 'password': 'correct-horse-123', 'remember_me': True}).status_code == 200
    assert tx(user, 'income', 100000).status_code == 200
    records = user.get('/api/state').json()['transactions']
    code = issue(admin, uid)
    with env.db() as c:
        token_hash = c.execute('SELECT token_hash FROM password_resets WHERE user_id=?', (uid,)).fetchone()[0]
        assert token_hash == env.hashlib.sha256(code.encode()).hexdigest()
        assert token_hash != code
        c.execute('UPDATE users SET failed=5,locked=? WHERE id=?', (env.time.time()+900, uid))
    reset_client = TestClient(env.app)
    response = reset_client.post('/api/password/reset', json=payload(code))
    assert response.status_code == 200
    assert 'new-private-password' not in response.text
    assert code not in response.text
    assert reset_client.get('/api/state').status_code == 401
    assert user.get('/api/state').status_code == 401
    assert other_device.get('/api/state').status_code == 401
    with env.db() as c:
        row = c.execute('SELECT password,failed,locked FROM users WHERE id=?', (uid,)).fetchone()
        assert row['password'] != 'new-private-password'
        assert row['failed'] == 0 and row['locked'] == 0
        assert not c.execute('SELECT 1 FROM password_resets WHERE user_id=?', (uid,)).fetchone()
    assert reset_client.post('/api/password/reset', json=payload(code)).status_code == 400
    assert reset_client.post('/api/login', json={'email': 'member@example.com', 'password': 'correct-horse-123'}).status_code == 401
    assert reset_client.post('/api/login', json={'email': 'member@example.com', 'password': 'new-private-password'}).status_code == 200
    assert reset_client.get('/api/state').json()['transactions'] == records
    admin_response = admin.get('/api/admin').json()
    assert all('password' not in member for member in admin_response['users'])


def test_wrong_expired_and_replaced_codes(recovery):
    env, admin, user, uid = recovery
    client = TestClient(env.app)
    old = issue(admin, uid)
    new = issue(admin, uid)
    assert new != old
    incorrect = client.post('/api/password/reset', json=payload(old))
    absent = client.post('/api/password/reset', json=payload(old, email='absent@example.com'))
    assert incorrect.status_code == absent.status_code == 400
    assert incorrect.json() == absent.json()
    # A code cannot be used for somebody else's email.
    assert client.post('/api/password/reset', json=payload(new, email='one@example.com')).status_code == 400
    with env.db() as c:
        c.execute('UPDATE password_resets SET expires=? WHERE user_id=?', (env.time.time()-1, uid))
    assert client.post('/api/password/reset', json=payload(new)).status_code == 400
    assert user.get('/api/state').status_code == 200


def test_password_validation_does_not_consume_code(recovery):
    env, admin, user, uid = recovery
    client = TestClient(env.app)
    code = issue(admin, uid)
    assert client.post('/api/password/reset', json={**payload(code), 'confirm_password': 'different-password'}).status_code == 400
    assert client.post('/api/password/reset', json=payload(code, password='short')).status_code == 422
    assert client.post('/api/password/reset', json=payload(code), headers={'Origin': 'https://evil.example'}).status_code == 403
    # Normalize email/code, but preserve password spaces exactly.
    assert client.post('/api/password/reset', json=payload(' '+code+' ', email=' MEMBER@example.com ', password='  new secret  ')).status_code == 200
    assert client.post('/api/login', json={'email': 'member@example.com', 'password': '  new secret  '}).status_code == 200


def test_disabled_accounts_cannot_reset_or_reuse_previous_code(recovery):
    env, admin, user, uid = recovery
    code = issue(admin, uid)
    assert admin.put(f'/api/admin/users/{uid}', json={'active': False}).status_code == 200
    assert admin.post(f'/api/admin/users/{uid}/reset-code', json={}).status_code == 400
    client = TestClient(env.app)
    assert client.post('/api/password/reset', json=payload(code)).status_code == 400
    assert admin.put(f'/api/admin/users/{uid}', json={'active': True}).status_code == 200
    assert client.post('/api/password/reset', json=payload(code)).status_code == 400


def test_code_is_consumed_once_even_with_concurrent_requests(recovery):
    env, admin, user, uid = recovery
    code = issue(admin, uid)
    def reset(_):
        with TestClient(env.app) as client:
            return client.post('/api/password/reset', json=payload(code)).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(reset, range(2))) == [200, 400]


def test_local_command_can_recover_administrator(recovery):
    env, admin, user, uid = recovery
    result = subprocess.run([sys.executable, '-m', 'app.manage', 'reset-code', 'one@example.com'],
                            capture_output=True, text=True, env={**os.environ, 'PENNY_DB': env.DB})
    assert result.returncode == 0
    code = result.stdout.split('Reset code: ', 1)[1].splitlines()[0]
    assert TestClient(env.app).post('/api/password/reset', json=payload(code, email='one@example.com')).status_code == 200
    assert admin.get('/api/admin').status_code == 401
