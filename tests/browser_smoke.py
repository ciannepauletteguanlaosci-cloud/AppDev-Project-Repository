"""Optional browser smoke check. Run against an isolated QA database, never a real account."""
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

base=os.environ.get('PENNY_TEST_URL','http://penny-wais-app-1:8001')
out=Path('/work/docs/screenshots'); out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base)
    page.get_by_role('button',name='Create an account',exact=True).click()
    page.get_by_label('Your name',exact=True).fill('Alex')
    page.get_by_label('Email address').fill(f'qa-{time.time_ns()}@example.com')
    page.get_by_label('Password',exact=True).fill('Browser-test-only-123')
    page.get_by_role('button',name='Create my account').click()
    page.get_by_role('heading',name='A little wiser, Alex.').wait_for()
    page.get_by_role('button',name='Load sample data').click()
    page.get_by_text('Rainy day fund',exact=True).wait_for()
    page.wait_for_timeout(3700)
    page.screenshot(path=str(out/'dashboard-desktop.png'),full_page=True)
    page.get_by_role('button',name='Add transaction',exact=True).click()
    page.get_by_label('Description',exact=True).fill('Browser test meal')
    page.get_by_label('Amount (₱)',exact=True).fill('123.45')
    page.get_by_role('dialog').get_by_role('button',name='Add transaction').click()
    page.locator('.transaction-name').filter(has_text='Browser test meal').wait_for()
    page.get_by_role('button',name='Transactions',exact=True).click()
    page.get_by_label('Search transactions').fill('Browser test meal')
    assert page.locator('tbody tr').count()==1
    page.get_by_role('button',name='Wallet buckets',exact=True).click()
    page.get_by_role('button',name='New bucket',exact=True).click()
    page.get_by_label('Bucket name').fill('Weekend plans')
    page.get_by_label('Set aside (₱)').fill('100')
    page.get_by_label('Goal (₱)').fill('1000')
    page.get_by_role('button',name='Save bucket').click()
    page.get_by_text('Weekend plans',exact=True).wait_for()
    page.get_by_role('button',name='Shared budgets',exact=True).click()
    page.get_by_role('button',name='Create group',exact=True).click()
    page.get_by_label('Group name').fill('Weekend crew')
    page.get_by_role('dialog').get_by_role('button',name='Create group',exact=True).click()
    page.get_by_role('button',name='Weekend crew',exact=False).click()
    page.get_by_role('heading',name='Who owes what').wait_for()
    page.get_by_role('button',name='Add shared expense',exact=True).click()
    page.get_by_label('Description',exact=True).fill('Picnic')
    page.get_by_label('Total paid (₱)').fill('200')
    page.get_by_role('button',name='Record expense',exact=True).click()
    page.get_by_text('Picnic',exact=True).wait_for()
    page.get_by_role('button',name='Insights',exact=True).click()
    page.get_by_role('heading',name='Your category outlook',exact=True).wait_for()
    page.get_by_role('button',name='Monthly budgets',exact=True).click()
    page.get_by_role('button',name='Set a budget',exact=True).click()
    page.get_by_label('Monthly limit (₱)').fill('2000')
    page.get_by_role('dialog').get_by_role('button',name='Set budget').click()
    page.get_by_role('button',name='Overview',exact=True).click()
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(3700)
    page.screenshot(path=str(out/'dashboard-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile horizontal overflow'
    for nav in ['Transactions','Wallet buckets','Shared budgets','Insights']:
        page.get_by_role('button',name=nav,exact=True).click()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),nav+' overflow'
    page.get_by_role('button',name='Help and account',exact=True).click()
    page.get_by_role('button',name='Sign out',exact=True).click()
    page.get_by_role('heading',name='Good to have you back.').wait_for()
    page.screenshot(path=str(out/'signin-mobile.png'),full_page=True)
    assert not errors,errors
    live=browser.new_page()
    live.goto('http://penny-wais-app-1:8000/')
    live.wait_for_timeout(2200)
    css=Path('/work/app/static/style.css')
    before=css.stat()
    try:
        with live.expect_navigation(timeout=10000):
            os.utime(css, None)
    finally:
        os.utime(css, ns=(before.st_atime_ns,before.st_mtime_ns))
    browser.close()
    print('Browser smoke passed: registration, sample data, transactions, filtering, buckets, groups, shared expenses, insights, budgets, mobile layouts, logout; no JavaScript errors.')
