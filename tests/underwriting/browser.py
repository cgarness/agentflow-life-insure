"""Exercise the built chat route. Optional local-render mode is visual-only evidence."""
import base64
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / '.underwriting-check'
BROWSER = os.environ.get('UW_BROWSER', 'chromium')
SHOTS = OUT / 'screenshots'
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('UW_TEST_URL', 'http://127.0.0.1:4173')
LOCAL = os.environ.get('UW_LOCAL_RENDER') == '1'
checks = []

def record(name):
    checks.append(name)
    print('PASS:', name, flush=True)

def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'

def load(browser, width=390, route='/underwriting'):
    context = browser.new_context(viewport={'width': width, 'height': 900}, device_scale_factor=1)
    page = context.new_page()
    page.set_default_timeout(10000)
    errors, requests, initial = [], [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: initial.append(r.url))
    page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    page.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    if LOCAL:
        css = next((ROOT / 'dist/assets').glob('index-*.css')).read_text()
        js = Path(os.environ['UW_LOCAL_SCRIPT']).read_text()
        page.set_content('<html><head><style>' + css + '</style></head><body><div id="root"></div></body></html>')
        page.add_script_tag(content=js)
        page.wait_for_selector('#quick-note')
        logo = 'data:image/png;base64,' + base64.b64encode((ROOT / 'public/agentflow-logo-full-on-dark.png').read_bytes()).decode()
        page.locator('img[alt="AgentFlow"]').evaluate('(img, src) => img.src = src', logo)
    else:
        page.goto(BASE + route, wait_until='networkidle')
        page.wait_for_selector('#quick-note')
        assert not any('/assets/App-' in u or 'supabase' in u or 'twilio' in u for u in initial), initial
    page.on('request', lambda r: requests.append(r.url))
    return context, page, errors, requests

def basics(page, smoking='nonsmoker'):
    page.locator('#quick-age').fill('65')
    page.locator('#quick-state').select_option('TX')
    page.locator('#quick-height').select_option('66')
    page.locator('#quick-weight').fill('170')
    page.locator('#quick-smoking').select_option(smoking)

def send(page, text):
    page.locator('#quick-note').fill(text)
    page.get_by_role('button', name='Send health note', exact=True).click()

def answer(page, q, text):
    page.locator(f'[data-question="{q}"]').get_by_role('button', name=text, exact=True).click()

def safe(context, page, errors, requests):
    no_overflow(page)
    assert not errors, errors
    assert not requests, requests
    context.close()

with sync_playwright() as p:
    executable = os.environ.get('UW_CHROMIUM_PATH')
    browser = getattr(p, BROWSER).launch(**({'executable_path': executable, 'args': ['--no-sandbox']} if executable and BROWSER == 'chromium' else {}))
    for route in ['/underwriting', '/underwritin', '/underwriting/']:
        ctx, page, errors, requests = load(browser, route=route)
        expect(page.get_by_role('heading', name='Quick underwriting.')).to_be_visible()
        expect(page.locator('#quick-age')).to_have_value('')
        expect(page.locator('#quick-note')).to_have_value('')
        expect(page.get_by_role('button', name='Send health note')).to_be_disabled()
        assert page.locator('html').evaluate("e => e.classList.contains('dark')")
        assert page.locator('img[alt="AgentFlow"]').evaluate('img => img.complete && img.naturalWidth > 0')
        assert page.locator('a[aria-label="AgentFlow home"]').get_attribute('href') == '/'
        assert page.locator('[data-carrier]').count() == 0
        record(f'{route}: blank dark AgentFlow chat with real logo; public entry isolated')
        safe(ctx, page, errors, requests)
    for width in [320, 375, 390, 768, 1440]:
        ctx, page, errors, requests = load(browser, width)
        page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-start-{width}.png'), full_page=True)
        basics(page)
        send(page, 'type 2 diabetes copd had cancer 7 years ago')
        expect(page.locator('[data-carrier]')).to_have_count(3)
        assert page.locator('[data-question]').count() <= 2
        assert page.locator('[data-fit="green"]').count() == 0
        assert page.get_by_role('button', name='Edit', exact=True).count() == 1
        page.locator('summary').filter(has_text='Picked up').click()
        assert 'Cancer treatment complete' not in page.locator('body').inner_text()
        page.locator('summary').filter(has_text='Picked up').click()
        page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-results-{width}.png'), full_page=True)
        record(f'{width}px: requested shorthand case → 3 short cards, ≤2 follow-ups, no invented treatment end')
        safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    send(page, 'COPD')
    expect(page.get_by_text('Complete the client basics first.', exact=True)).to_be_visible()
    assert page.locator('[data-carrier]').count() == 0
    basics(page)
    page.locator('#quick-age').fill('65.5')
    send(page, 'COPD')
    assert page.locator('[data-carrier]').count() == 0
    record('Zod blocks absent or malformed basics; no blank-default candidates')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page, 'former')
    send(page, 'COPD')
    assert page.locator('[data-carrier]').count() == 0
    page.locator('#quick-quit').fill('8')
    send(page, 'COPD')
    expect(page.locator('[data-carrier]')).to_have_count(3)
    record('Recent quitter requires actual duration; no silent nonsmoker mapping')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page)
    send(page, 'takes metfornin')
    expect(page.get_by_text('“metfornin” — did you mean:', exact=True)).to_be_visible()
    assert page.locator('[data-fit="green"]').count() == 0
    page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-medication-confirmation.png'), full_page=True)
    page.get_by_role('button', name='Metformin', exact=True).click()
    expect(page.get_by_text('“metfornin” — did you mean:', exact=True)).to_have_count(0)
    page.locator('summary').filter(has_text='Picked up').click()
    expect(page.get_by_role('button', name='Remove Metformin', exact=True)).to_have_count(1)
    assert page.get_by_role('button', name='Remove Diabetes', exact=True).count() == 0
    record('Drug typo is a confirmable suggestion, never a diagnosis or automatic substitution')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page); send(page, 'COPD')
    answer(page, 'oxygen', 'No');answer(page, 'care', 'No');answer(page, 'recent', 'No');answer(page, 'complete', 'Nothing else')
    expect(page.locator('[data-carrier="transamerica"]')).to_have_attribute('data-fit', 'green')
    expect(page.locator('[data-carrier="americo"]')).to_have_attribute('data-fit', 'yellow')
    expect(page.locator('[data-carrier="mutual"]')).to_have_attribute('data-fit', 'yellow')
    expect(page.get_by_text('Commission order is pending your verified schedules. No payout ranking is assumed.', exact=True)).to_be_visible()
    page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-green-screen.png'), full_page=True)
    record('Complete single-condition stated screen is green; source gaps remain yellow, no invented commission')
    send(page, 'on oxygen')
    expect(page.locator('[data-carrier="americo"]')).to_have_attribute('data-fit', 'red')
    assert page.locator('[data-fit="green"]').count() == 0
    page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-updated-results.png'), full_page=True)
    record('New adverse chat detail immediately invalidates prior green result')
    page.get_by_role('button', name='Edit', exact=True).click()
    page.locator('#quick-age').fill('')
    assert page.locator('[data-carrier]').count() == 0
    page.locator('#quick-age').fill('90')
    expect(page.locator('[data-fit="red"]')).to_have_count(3)
    record('Basic edits invalidate or recompute cards without stale classifications')
    page.get_by_role('button', name='New case', exact=True).click()
    expect(page.locator('#quick-age')).to_have_value('')
    expect(page.locator('#quick-note')).to_have_value('')
    assert page.locator('[data-carrier]').count() == 0
    record('New case clears chat, basics, facts, suggestions and all results')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page);send(page, 'COPD');answer(page, 'oxygen', 'Not sure')
    assert page.locator('[data-question="oxygen"]').count() == 0
    assert page.locator('[data-fit="green"]').count() == 0
    record('Not sure never becomes No and does not trap the agent in repeated prompts')
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    expect(page.locator('#quick-note')).to_have_count(0)
    page.evaluate("window.dispatchEvent(new Event('pageshow'))")
    expect(page.locator('#quick-age')).to_have_value('')
    expect(page.locator('#quick-note')).to_have_value('')
    assert page.locator('[data-carrier]').count() == 0
    record('Back-forward page lifecycle clears health data synchronously before blank restore')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page);send(page, '<img src=x onerror="window.pwned=true"> COPD')
    assert not page.evaluate('Boolean(window.pwned)')
    assert page.locator('img').count() == 1
    record('Untrusted notes rendered as literal text; only the existing brand image is present')
    page.get_by_role('button', name='New case').click();basics(page)
    send(page, 'client@example.com has COPD')
    expect(page.get_by_text('Remove the client’s email, phone or identifying numbers. Health details only.', exact=True)).to_be_visible()
    assert page.locator('[data-carrier]').count() == 0
    record('Obvious identifying email/phone/SSN formats are rejected; no case network requests')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page);page.locator('#quick-note').fill('COPD');page.locator('#quick-note').press('Shift+Enter')
    assert page.locator('[data-carrier]').count() == 0
    page.locator('#quick-note').press('Enter')
    expect(page.locator('[data-carrier]')).to_have_count(3)
    record('Keyboard Enter sends, Shift+Enter preserves multiline entry')
    safe(ctx, page, errors, requests)
    browser.close()
report = {'passed':len(checks),'failed':0,'environment': 'Local isolated render; not a hosted route test' if LOCAL else f'{BROWSER}; real repository production Vite build served locally on runner; not physical iOS', 'checks':checks}
(OUT/f'browser-tests-{BROWSER}.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
