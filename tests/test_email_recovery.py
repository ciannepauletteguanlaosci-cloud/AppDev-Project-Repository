import hashlib
import importlib
import smtplib
import sqlite3

import pytest
from fastapi.testclient import TestClient
from test_app import env, account, tx
from test_password_reset import payload


@pytest.fixture
def email_service(env, monkeypatch):
    for name, value in {'SMTP_HOST':'smtp.example.test', 'SMTP_PORT':'587',
                        'SMTP_SECURITY':'starttls', 'SMTP_USERNAME':'sender@example.test',
                        'SMTP_PASSWORD':'smtp-secret', 'SMTP_FROM':'sender@example.test'}.items():
        monkeypatch.setenv(name, value)
    deliveries = []
    monkeypatch.setattr(env.mail, 'send_reset_code', lambda email, code: deliveries.append((email, code)))
    return deliveries


def test_email_recovery_round_trip_preserves_records_and_hides_code(env, email_service):
    owner = account(env, 'member@example.com')
    assert tx(owner, 'income', 20000).status_code == 200
    records = owner.get('/api/state').json()['transactions']
    client = TestClient(env.app)
    response = client.post('/api/password/forgot', json={'email':' MEMBER@example.com '})
    assert response.status_code == 202
    assert len(email_service) == 1
    email, code = email_service[0]
    assert email == 'member@example.com' and len(code) == 8 and code.isdecimal()
    assert code not in response.text
    with env.db() as c:
        stored = c.execute('SELECT * FROM password_resets').fetchone()
        assert stored['token_hash'] == hashlib.sha256(code.encode()).hexdigest()
        assert stored['attempts'] == 0
    assert client.post('/api/password/reset', json=payload(code)).status_code == 200
    assert owner.get('/api/state').status_code == 401
    assert client.post('/api/password/reset', json=payload(code)).status_code == 400
    assert client.post('/api/login', json={'email':email,'password':'new-private-password'}).status_code == 200
    assert client.get('/api/state').json()['transactions'] == records


def test_unknown_and_disabled_accounts_have_identical_responses(env, email_service):
    account(env, 'member@example.com')
    account(env, 'disabled@example.com')
    with env.db() as c:
        c.execute('UPDATE users SET active=0 WHERE email=?', ('disabled@example.com',))
    client = TestClient(env.app)
    responses = [client.post('/api/password/forgot', json={'email':email}) for email in
                 ('member@example.com', 'missing@example.com', 'disabled@example.com')]
    assert all(r.status_code == 202 for r in responses)
    assert responses[0].json() == responses[1].json() == responses[2].json()
    assert len(email_service) == 1


def test_cooldown_replacement_and_email_limit(env, email_service, monkeypatch):
    account(env, 'member@example.com')
    client = TestClient(env.app)
    now = env.time.time()
    monkeypatch.setattr(env.time, 'time', lambda: now)
    def request():
        return client.post('/api/password/forgot', json={'email':'member@example.com'})
    assert request().status_code == 202
    original = email_service[0][1]
    cooldown = request()
    assert cooldown.status_code == 429 and len(email_service) == 1
    assert 'one minute' in cooldown.json()['detail']
    now += 61
    request()
    assert len(email_service) == 2
    assert client.post('/api/password/reset', json=payload(original)).status_code == 400
    now += 61
    request()
    assert len(email_service) == 3
    now += 61
    limited = request()
    assert limited.status_code == 429 and len(email_service) == 3
    assert '15 minutes' in limited.json()['detail']
    now += 901
    assert client.post('/api/password/reset', json=payload(email_service[-1][1])).status_code == 400


def test_five_wrong_guesses_invalidate_email_code(env, email_service):
    account(env, 'member@example.com')
    client = TestClient(env.app)
    client.post('/api/password/forgot', json={'email':'member@example.com'})
    for _ in range(5):
        assert client.post('/api/password/reset', json=payload('wrong-code')).status_code == 400
    assert client.post('/api/password/reset', json=payload(email_service[0][1])).status_code == 400
    with env.db() as c:
        assert not c.execute('SELECT 1 FROM password_resets').fetchone()


def test_delivery_failure_removes_code_and_does_not_expose_errors(env, email_service, monkeypatch, caplog):
    owner = account(env, 'member@example.com')
    def fail_send(*args):
        raise smtplib.SMTPAuthenticationError(535, b'smtp-secret member@example.com')
    monkeypatch.setattr(env.mail, 'send_reset_code', fail_send)
    response = TestClient(env.app).post('/api/password/forgot', json={'email':'member@example.com'})
    assert response.status_code == 202
    assert 'smtp-secret' not in response.text+caplog.text
    assert 'member@example.com' not in caplog.text
    assert 'delivery failed' in caplog.text
    assert owner.get('/api/state').status_code == 200
    with env.db() as c:
        assert not c.execute('SELECT 1 FROM password_resets').fetchone()


def test_missing_config_and_invalid_email_do_not_claim_delivery(env, email_service, monkeypatch):
    client = TestClient(env.app)
    monkeypatch.setenv('SMTP_PASSWORD', '')
    assert client.post('/api/password/forgot', json={'email':'member@example.com'}).status_code == 503
    assert not email_service
    for email in ('member@example.com\r\nBcc:another@example.com', 'one@example.com,two@example.com'):
        assert client.post('/api/password/forgot', json={'email':email}).status_code == 422
    assert client.post('/api/password/forgot', json={'email':'one@example.com'}, headers={'Origin':'https://evil.example'}).status_code == 403


def test_ip_limits_apply_to_unknown_accounts_and_wrong_codes(env, email_service):
    client = TestClient(env.app)
    for i in range(20):
        assert client.post('/api/password/forgot', json={'email':f'missing{i}@example.com'}).status_code == 202
    assert client.post('/api/password/forgot', json={'email':'last@example.com'}).status_code == 429
    for _ in range(30):
        assert client.post('/api/password/reset', json=payload('wrong-code')).status_code == 400
    assert client.post('/api/password/reset', json=payload('wrong-code')).status_code == 429
    assert not email_service


@pytest.mark.parametrize('security,port', [('starttls','587'), ('ssl','465')])
def test_smtp_uses_tls_before_auth_and_sends_only_reset_content(env, monkeypatch, security, port):
    for name, value in {'SMTP_HOST':'smtp.example.test','SMTP_PORT':port,'SMTP_SECURITY':security,
                        'SMTP_USERNAME':'sender@example.test','SMTP_PASSWORD':'smtp-secret',
                        'SMTP_FROM':'sender@example.test'}.items():
        monkeypatch.setenv(name, value)
    events = []
    messages = []
    class SMTP:
        def __init__(self, host, port, timeout, context=None):
            assert host == 'smtp.example.test' and timeout == 15
            if security == 'ssl':
                assert context.check_hostname
                events.append('tls')
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def ehlo(self): pass
        def starttls(self, context):
            assert context.check_hostname
            events.append('tls')
        def login(self, username, password):
            assert events == ['tls'] and password == 'smtp-secret'
            events.append('login')
        def send_message(self, message):
            assert events == ['tls','login']
            messages.append(message)
            return {}
    monkeypatch.setattr(env.mail.smtplib, 'SMTP', SMTP)
    monkeypatch.setattr(env.mail.smtplib, 'SMTP_SSL', SMTP)
    env.mail.send_reset_code('member@example.com', '01234567')
    assert messages[0]['To'] == 'member@example.com'
    body = messages[0].get_content()
    assert '01234567' in body and '15 minutes' in body
    assert 'smtp-secret' not in messages[0].as_string()


def test_existing_reset_codes_survive_schema_upgrade(tmp_path, monkeypatch):
    path = tmp_path/'old.db'
    with sqlite3.connect(path) as c:
        c.execute('CREATE TABLE password_resets(user_id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL, expires REAL NOT NULL)')
        c.execute('INSERT INTO password_resets VALUES(1,?,?)', ('existing-hash', 9999999999))
    monkeypatch.setenv('PENNY_DB', str(path))
    from app import main
    importlib.reload(main)
    with main.db() as c:
        row = c.execute('SELECT * FROM password_resets').fetchone()
        assert row['token_hash'] == 'existing-hash' and row['attempts'] == 0
