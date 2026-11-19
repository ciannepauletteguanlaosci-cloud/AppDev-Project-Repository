import httpx
import json
import pytest
from fastapi.testclient import TestClient
from test_app import env, account


@pytest.fixture
def provider(env, monkeypatch):
    monkeypatch.setenv('BRANKAS_ENVIRONMENT', 'sandbox')
    monkeypatch.setenv('BRANKAS_API_KEY', 'server-only-test-secret')
    calls = []
    data = {'statement_id': 'owned-statement', 'redirect_uri': 'https://pidp-server.bnk.to/?statement_id=owned-statement'}

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return httpx.Response(200, json=data.copy())

    monkeypatch.setattr(env.brankas.httpx, 'request', request)
    return calls, data


def test_link_authorization_and_ownership(env, provider):
    calls, data = provider
    owner, other = account(env), account(env, 'other@example.com')
    assert TestClient(env.app).post('/api/bank-connections').status_code == 401
    result = owner.post('/api/bank-connections').json()
    cid = result['id']
    assert result['status'] == 'pending'
    method, url, args = calls[0]
    assert method == 'POST' and url.endswith('/v1/statement-init')
    assert args['headers']['x-api-key'] == 'server-only-test-secret'
    assert args['json']['bank_codes'] == ['DUMMY_BANK_PERSONAL']
    assert args['json']['auto_consent'] is False
    assert args['json']['app_redirect_uri'] == 'http://testserver/bank-return'
    assert 'one@example.com' not in str(args['json'])
    assert len(owner.get('/api/bank-connections').json()['connections']) == 1
    assert other.get('/api/bank-connections').json()['connections'] == []
    assert other.post(f'/api/bank-connections/{cid}/refresh').status_code == 404
    assert other.delete(f'/api/bank-connections/{cid}').status_code == 404
    assert len(calls) == 1
    # A browser return cannot assert success or substitute someone else's ID.
    returned = owner.get('/bank-return?statement_id=someone-else&status=COMPLETED', follow_redirects=False)
    assert returned.status_code == 303 and returned.headers['location'] == '/#connections'
    assert owner.get('/api/bank-connections').json()['connections'][0]['status'] == 'pending'
    data.clear()
    data.update({'statements': [
        {'statement_id': 'someone-else', 'status': 'COMPLETED', 'account_statements': [{'account': {'nick': 'PRIVATE'}}]},
        {'statement_id': 'owned-statement', 'status': 'COMPLETED', 'account_statements': [{
            'account': {'nick': 'My test savings', 'bank_code': 'DUMMY_BANK_PERSONAL', 'account_number': '1234567890',
                        'balance': {'cur': 'PHP', 'num': '12345'}, 'holder_name': 'PRIVATE HOLDER'},
            'transactions': [{'descriptor': 'PRIVATE TRANSACTION'}],
        }]},
    ]})
    response = owner.post(f'/api/bank-connections/{cid}/refresh')
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['status'] == 'linked' and saved['redirect_uri'] == ''
    assert len(saved['accounts'][0].pop('account_key')) == 64
    assert saved['accounts'] == [{'name': 'My test savings', 'last_four': '7890', 'balance': 12345, 'transaction_count': 1}]
    assert 'PRIVATE' not in response.text and '1234567890' not in response.text
    assert 'server-only-test-secret' not in owner.get('/api/bank-connections').text
    state = owner.get('/api/state').json()
    assert state['balance'] == 0 and state['unallocated'] == 0 and state['transactions'] == []
    assert owner.post(f'/api/bank-connections/{cid}/refresh').status_code == 429
    assert owner.delete(f'/api/bank-connections/{cid}').status_code == 200
    assert owner.post(f'/api/bank-connections/{cid}/refresh').status_code == 404


@pytest.mark.parametrize('status,payload', [(400, {'code': 7, 'message': 'permission denied'}), (401, {}), (429, {}), (500, {'message': 'SECRET'})])
def test_provider_error_is_actionable_and_not_a_connection(env, provider, monkeypatch, status, payload):
    client = account(env)
    monkeypatch.setattr(env.brankas.httpx, 'request', lambda *a, **kw: httpx.Response(status, json=payload))
    response = client.post('/api/bank-connections')
    assert response.status_code in (502, 503)
    assert 'SECRET' not in response.text
    if status in (400, 401):
        assert 'Statement' in response.text and 'auth.brankas.com' in response.text
    assert client.get('/api/bank-connections').json()['connections'] == []


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'http://pidp-server.bnk.to', 'https://bnk.to.evil.test', 'https://bnk.to@evil.test', 'https://evil.test', 'https://pidp-server.bnk.to:8000', 'http://tap.sandbox.brank.as', 'https://tap.sandbox.brank.as.evil.test', 'https://tap.sandbox.brank.as@evil.test', 'https://tap.sandbox.brank.as:8000', 'https://evil.tap.sandbox.brank.as', None])
def test_untrusted_redirect_rejected(env, provider, url):
    provider[1]['redirect_uri'] = url
    client = account(env)
    assert client.post('/api/bank-connections').status_code == 502
    assert client.get('/api/bank-connections').json()['connections'] == []


@pytest.mark.parametrize('host', ['pidp-server.bnk.to', 'tap.sandbox.brank.as'])
def test_provider_authorization_hosts_accepted(env, provider, host):
    redirect = f'https://{host}/?statement_id=owned-statement'
    provider[1]['redirect_uri'] = redirect
    client = account(env)
    response = client.post('/api/bank-connections')
    assert response.status_code == 200, response.text
    assert response.json()['redirect_uri'] == redirect
    saved = client.get('/api/bank-connections').json()['connections'][0]
    assert saved['status'] == 'pending'
    assert saved['redirect_uri'] == redirect


def test_configuration_timeout_and_attempt_limit(env, provider, monkeypatch):
    client = account(env)
    monkeypatch.setenv('BRANKAS_API_KEY', '')
    assert client.get('/api/bank-connections').json()['configured'] is False
    assert client.post('/api/bank-connections').status_code == 503
    monkeypatch.setenv('BRANKAS_API_KEY', 'test-key')
    monkeypatch.setenv('BRANKAS_ENVIRONMENT', 'production')
    assert client.post('/api/bank-connections').status_code == 503
    monkeypatch.setenv('BRANKAS_ENVIRONMENT', 'sandbox')
    def timeout(*a, **kw):
        raise httpx.ReadTimeout('secret provider error')
    monkeypatch.setattr(env.brankas.httpx, 'request', timeout)
    for _ in range(5):
        response = client.post('/api/bank-connections')
        assert response.status_code == 502
        assert 'secret provider error' not in response.text
    assert client.post('/api/bank-connections').status_code == 429


def test_duplicate_statement_and_expired_session(env, provider):
    owner, other = account(env), account(env, 'other@example.com')
    cid = owner.post('/api/bank-connections').json()['id']
    assert other.post('/api/bank-connections').status_code == 502
    assert other.get('/api/bank-connections').json()['connections'] == []
    with env.db() as c:
        c.execute('UPDATE bank_connections SET created=1 WHERE id=?', (cid,))
    assert owner.post(f'/api/bank-connections/{cid}/refresh').status_code == 410
    row = owner.get('/api/bank-connections').json()['connections'][0]
    assert row['status'] == 'expired' and row['redirect_uri'] == ''


@pytest.mark.parametrize('status,expected', [('INITIATED_Status','pending'), ('FAILED','failed'), ('CANCELLED','cancelled'), ('COMPLETED','no_accounts')])
def test_status_mapping(env, status, expected):
    assert env.brankas.summarize({'status': status}) == (expected, [])


def test_statement_pagination_never_uses_unrelated_accounts(env, provider, monkeypatch):
    calls = []
    def request(method, url, **kwargs):
        calls.append(kwargs['params'])
        if len(calls) == 1:
            return httpx.Response(200, json={'statements': [{'statement_id': 'other-user'}], 'next_page_token': 'next'})
        return httpx.Response(200, json={'statements': [{'statement_id': 'owned-statement', 'status': 'COMPLETED'}]})
    monkeypatch.setattr(env.brankas.httpx, 'request', request)
    assert env.brankas.statement('owned-statement')['statement_id'] == 'owned-statement'
    assert calls == [{}, {'page_token': 'next'}]


def test_wallet_total_uses_newest_unique_known_balances_and_is_private(env):
    owner, other = account(env), account(env, 'other@example.com')
    uid = owner.get('/api/state').json()['user']['id']
    other_uid = other.get('/api/state').json()['user']['id']
    from test_app import tx
    assert tx(owner, 'income', 10000).status_code == 200
    def save(cid, user, created, status, accounts):
        with env.db() as c:
            c.execute('INSERT INTO bank_connections(id,user_id,status,accounts,created,checked) VALUES(?,?,?,?,?,?)',
                      (cid,user,status,json.dumps(accounts),created,99999-created))
    save('old',uid,10,'linked',[{'account_key':'same','balance':50000}, {'account_key':'missing-now','balance':40000}])
    save('new',uid,20,'linked',[{'account_key':'same','balance':11000}, {'account_key':'missing-now','balance':None}, {'account_key':'zero','balance':0}, {'account_key':'negative','balance':-1000}])
    save('pending',uid,30,'pending',[{'account_key':'pending','balance':999999}])
    save('legacy',uid,5,'linked',[{'balance':999999}])
    save('private',other_uid,40,'linked',[{'account_key':'same','balance':77777}])
    state = owner.get('/api/state').json()
    assert state['wallet_total'] == 20000
    assert state['connected_balance'] == 10000
    assert state['connected_accounts'] == 3
    assert state['missing_bank_balances'] == 1
    assert state['bank_balances_need_refresh'] == 1
    assert state['balance'] == state['unallocated'] == 10000
    assert len(state['transactions']) == 1
    assert other.get('/api/state').json()['wallet_total'] == 77777
    assert owner.get('/api/bank-connections').json()['wallet_summary']['wallet_total'] == 20000
    assert tx(owner, 'expense', 15000).status_code == 400  # Test money is not spendable.
    for cid in ('new', 'old', 'legacy'):
        assert owner.delete('/api/bank-connections/'+cid).status_code == 200
    assert owner.get('/api/state').json()['wallet_total'] == 10000


def test_account_identity_survives_relink_but_distinguishes_same_last_four(env):
    def key(number, bank, account_id):
        return env.brankas.summarize({'status':'COMPLETED','bank_code':bank,'account_statements':[{'account':{'account_number':number,'account_id':account_id}}]})[1][0]['account_key']
    assert key('1111234','bank-one','old-id') == key('1111234','bank-one','new-id')
    assert key('1111234','bank-one','id') != key('2221234','bank-one','id')
    assert key('1111234','bank-one','id') != key('1111234','bank-two','id')
    assert key('','','') is None
