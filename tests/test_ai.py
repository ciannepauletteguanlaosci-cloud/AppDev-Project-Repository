import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from test_app import account, env, tx


@pytest.fixture
def ai(env, monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY', 'test-server-secret')
    monkeypatch.setenv('GEMINI_MODEL', 'test-model')
    calls = []

    def generate(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(200, json={'candidates': [{
            'finishReason': 'STOP',
            'content': {'parts': [{'text': 'Set a small weekly savings goal.'}]},
        }]})

    monkeypatch.setattr(env.httpx, 'post', generate)
    return env, calls


def test_ai_auth_validation_and_no_implicit_data_sharing(ai):
    env, calls = ai
    assert TestClient(env.app).post('/api/ai/ask', json={'question': 'Help'}).status_code == 401
    client = account(env)
    assert tx(client, 'income', 10000).status_code == 200
    for payload in ({'question': '  '}, {'question': 'x'*2001}, {'question': 'Help', 'include_summary': 'false'}):
        assert client.post('/api/ai/ask', json=payload).status_code == 422
    assert not calls
    result = client.post('/api/ai/ask', json={'question': 'How can I save?'})
    assert result.status_code == 200
    assert result.json()['summary_included'] is False
    url, request = calls[0]
    assert url == 'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent'
    assert request['headers']['x-goog-api-key'] == 'test-server-secret'
    prompt = json.loads(request['json']['contents'][0]['parts'][0]['text'])
    assert prompt == {'question': 'How can I save?', 'budget_summary': None}
    assert 'test-server-secret' not in result.text
    assert client.post('/api/ai/ask', headers={'Origin': 'https://other.example'}, json={'question': 'Help'}).status_code == 403


def test_ai_summary_is_scoped_and_uses_centavos(ai):
    env, calls = ai
    client, other = account(env), account(env, 'private-other@example.com')
    tx(client, 'income', 100000)
    tx(client, 'expense', 12000)
    tx(other, 'income', 99999999)
    client.post('/api/buckets', json={'name': 'Private bucket name', 'category': 'Savings', 'amount': 30000, 'target': 50000})
    client.post('/api/budgets', json={'category': 'Food', 'amount': 20000})
    before = client.get('/api/state').json()
    result = client.post('/api/ai/ask', json={'question': 'Explain my balance', 'include_summary': True})
    assert result.status_code == 200 and result.json()['summary_included']
    prompt_text = calls[0][1]['json']['contents'][0]['parts'][0]['text']
    summary = json.loads(prompt_text)['budget_summary']
    assert summary['wallet_balance_centavos'] == 88000
    assert summary['unallocated_centavos'] == 58000
    assert summary['reserved_centavos'] == 30000
    assert summary['monthly_budgets'] == [{'category': 'Food', 'limit_centavos': 20000}]
    for private in ('99999999', 'private-other', 'one@example.com', 'Private bucket name', 'Lunch', 'password', 'user_id'):
        assert private not in prompt_text
    assert client.get('/api/state').json() == before


@pytest.mark.parametrize('upstream,expected', [(400,503), (401,503), (403,503), (404,503), (429,429), (500,503)])
def test_ai_upstream_errors_hide_provider_details(ai, monkeypatch, upstream, expected):
    env, _ = ai
    monkeypatch.setattr(env.httpx, 'post', lambda *a, **kw: httpx.Response(upstream, json={'error': {'message': 'test-server-secret raw provider error'}}))
    response = account(env).post('/api/ai/ask', json={'question': 'Help'})
    assert response.status_code == expected
    assert 'test-server-secret' not in response.text and 'raw provider' not in response.text


@pytest.mark.parametrize('error,expected', [(httpx.ReadTimeout('private'),504), (httpx.ConnectError('private'),503)])
def test_ai_network_failures(ai, monkeypatch, error, expected):
    env, _ = ai
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(env.httpx, 'post', fail)
    response = account(env).post('/api/ai/ask', json={'question': 'Help'})
    assert response.status_code == expected and 'private' not in response.text


@pytest.mark.parametrize('payload,expected', [
    ({'candidates': []},502),
    ({'candidates': [{'finishReason': 'SAFETY'}]},422),
    ({'candidates': [{'finishReason': 'STOP', 'content': {'parts': []}}]},502),
    ({'candidates': None},502),
    ({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [None]}}]},502),
])
def test_ai_empty_blocked_and_malformed_responses(ai, monkeypatch, payload, expected):
    env, _ = ai
    monkeypatch.setattr(env.httpx, 'post', lambda *a, **kw: httpx.Response(200, json=payload))
    assert account(env).post('/api/ai/ask', json={'question': 'Help'}).status_code == expected


def test_ai_thoughts_are_excluded_and_truncation_reported(ai, monkeypatch):
    env, _ = ai
    monkeypatch.setattr(env.httpx, 'post', lambda *a, **kw: httpx.Response(200, json={'candidates': [{
        'finishReason': 'MAX_TOKENS', 'content': {'parts': [
            {'thought': True, 'text': 'Private reasoning'}, {'text': 'Visible answer'},
        ]},
    }]}))
    result = account(env).post('/api/ai/ask', json={'question': 'Help'}).json()
    assert result['answer'] == 'Visible answer' and result['truncated']


def test_ai_missing_key_and_invalid_model(ai, monkeypatch):
    env, calls = ai
    client = account(env)
    monkeypatch.setenv('GEMINI_API_KEY', '')
    assert client.post('/api/ai/ask', json={'question': 'Help'}).status_code == 503
    monkeypatch.setenv('GEMINI_API_KEY', 'test-server-secret')
    monkeypatch.setenv('GEMINI_MODEL', '../unexpected?key=value')
    assert client.post('/api/ai/ask', json={'question': 'Help'}).status_code == 503
    assert not calls


def test_ai_limits_persist_and_are_per_user(ai):
    env, calls = ai
    client, other = account(env), account(env, 'other@example.com')
    uid = client.get('/api/state').json()['user']['id']
    for _ in range(5):
        assert client.post('/api/ai/ask', json={'question': 'Help'}).status_code == 200
    assert client.post('/api/ai/ask', json={'question': 'Help'}).status_code == 429
    assert other.post('/api/ai/ask', json={'question': 'Help'}).status_code == 200
    with env.db() as c:
        c.execute('UPDATE ai_requests SET created=? WHERE user_id=?', (time.time()-120, uid))
        c.executemany('INSERT INTO ai_requests VALUES(?,?)', [(uid, time.time()-120)]*45)
    assert client.post('/api/ai/ask', json={'question': 'Help'}).status_code == 429
    with env.db() as c:
        c.execute('UPDATE ai_requests SET created=? WHERE user_id=?', (time.time()-86401, uid))
    assert client.post('/api/ai/ask', json={'question': 'Help'}).status_code == 200
