"""Server-only Brankas Statement sandbox adapter. Never accepts bank credentials."""
import os
import hashlib
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

BASE = 'https://statement.sandbox.bnk.to/v1'
ACCESS_ERROR = ('Brankas denied Statement access for the configured key. The administrator '
                'must use a Brankas sandbox key with Statement enabled from auth.brankas.com. '
                'Keys from sandboxapi.dev are for a different service.')


def configuration_error():
    if os.environ.get('BRANKAS_ENVIRONMENT', 'sandbox') != 'sandbox':
        return 'This version supports Brankas sandbox only. Set BRANKAS_ENVIRONMENT=sandbox.'
    if not os.environ.get('BRANKAS_API_KEY', '').strip():
        return 'Bank linking is not configured. Ask the administrator to set the Brankas sandbox key.'
    return ''


def request(method, path, **kwargs):
    error = configuration_error()
    if error:
        raise HTTPException(503, error)
    try:
        response = httpx.request(method, BASE + path, headers={
            'x-api-key': os.environ['BRANKAS_API_KEY'].strip(),
            'Accept': 'application/json',
        }, timeout=25, follow_redirects=False, **kwargs)
    except httpx.RequestError:
        raise HTTPException(502, 'Brankas could not be reached. Please try again later.') from None
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    if response.status_code in (401, 403) or data.get('code') in (7, 16) or 'permission denied' in str(data.get('message', '')).lower():
        raise HTTPException(503, ACCESS_ERROR)
    if response.status_code == 429:
        raise HTTPException(503, 'Brankas is receiving too many requests. Try again later.')
    if not response.is_success or not data:
        raise HTTPException(502, 'Brankas could not complete this request. Try again or contact the administrator.')
    return data


def valid_redirect(value):
    try:
        url = urlsplit(value)
        host = url.hostname or ''
        return (url.scheme == 'https' and not url.username and not url.password
                and url.port in (None, 443)
                and (host == 'tap.sandbox.brank.as'
                     or host.endswith('.bnk.to') or host.endswith('.brankas.com')))
    except (ValueError, TypeError):
        return False


def initiate(return_url, external_id):
    result = request('POST', '/statement-init', json={
        'country': 'PH', 'bank_codes': ['DUMMY_BANK_PERSONAL'],
        'external_id': external_id, 'organization_display_name': 'Penny Wais',
        'app_redirect_uri': return_url, 'app_redirect_error_uri': return_url,
        'remember_me': False, 'auto_consent': False, 'include_balance': True,
    })
    sid, redirect = result.get('statement_id'), result.get('redirect_uri')
    if not isinstance(sid, str) or not 1 <= len(sid) <= 200 or not valid_redirect(redirect):
        raise HTTPException(502, 'Brankas returned an invalid linking session. Please try again.')
    return sid, redirect


def statement(statement_id):
    # Do not trust callback/query-string IDs or return an organization-wide list.
    # Match ONLY the identifier obtained directly from initiation for this user.
    token = ''
    seen = set()
    for _ in range(10):
        data = request('GET', '/statements', params={'page_token': token} if token else {})
        rows = data.get('statements', [])
        if not isinstance(rows, list):
            raise HTTPException(502, 'Brankas returned an invalid statement response.')
        for row in rows:
            if isinstance(row, dict) and row.get('statement_id') == statement_id:
                return row
        token = data.get('next_page_token')
        if not token:
            return None
        if not isinstance(token, str) or token in seen:
            break
        seen.add(token)
    raise HTTPException(502, 'The statement could not be located in the Brankas response. Please try again later.')


def summarize(statement):
    status = statement.get('status', '')
    if status in ('FAILED', 'ERROR', 'LOGIN_ERROR', 'NO_ACCOUNT'):
        return 'failed', []
    if status in ('CANCELLED', 'INACTIVATED', 'PURGED'):
        return 'cancelled', []
    if status not in ('COMPLETED', 'NOTIFIED', 'Status_RECEIVED', 'RECORDS_AVAILABLE'):
        return 'pending', []
    rows = statement.get('account_statements', [])
    if not isinstance(rows, list):
        raise HTTPException(502, 'Brankas returned invalid account information.')
    accounts = []
    for row in rows[:50]:
        if not isinstance(row, dict) or not isinstance(row.get('account'), dict):
            continue
        account = row['account']
        balance = account.get('balance') or {}
        cents = None
        if isinstance(balance, dict) and balance.get('cur') == 'PHP':
            try:
                value = str(balance.get('num', ''))
                cents = int(value) if len(value) <= 16 else None
                if cents is not None and abs(cents) > 9007199254740991:
                    cents = None
            except ValueError:
                pass
        number = str(account.get('account_number') or '')
        bank = str(account.get('bank_code') or statement.get('bank_code') or '')
        identity = ('number', bank, number) if number and bank else ('id', str(account.get('account_id') or ''))
        account_key = hashlib.sha256(repr(identity).encode()).hexdigest() if identity[-1] else None
        accounts.append({
            'account_key': account_key,
            'name': str(account.get('nick') or 'Sandbox account')[:80],
            'last_four': number[-4:] if len(number) > 4 else '',
            'balance': cents,
            'transaction_count': len(row['transactions']) if isinstance(row.get('transactions'), list) else 0,
        })
    return ('linked' if accounts else 'no_accounts'), accounts
