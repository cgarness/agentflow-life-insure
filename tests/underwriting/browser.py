"""Exercise the built chat route; retain partial and security evidence on failure."""
import atexit
import base64
import hashlib
import json
import os
import subprocess
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
complete = False
script_sha256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
source_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()

def write_report():
    report = {'passed': len(checks), 'completed': complete, 'script_sha256': script_sha256,
              'checked_out_sha': source_sha, 'browser': BROWSER,
              'environment': 'Local isolated render' if LOCAL else 'Actual Vite production build; not physical iOS',
              'checks': checks}
    (OUT / f'browser-tests-{BROWSER}.json').write_text(json.dumps(report, indent=2))

atexit.register(write_report)
print('Browser script SHA256:', script_sha256, 'checkout:', source_sha, flush=True)

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

def security_snapshot(page):
    return page.evaluate('''() => ({
      sentinelType: typeof window.pwned,
      sentinelValue: String(window.pwned),
      sentinelTruthy: Boolean(window.pwned),
      images: Array.from(document.images, image => image.outerHTML),
      eventAttributes: Array.from(document.querySelectorAll('*')).flatMap(element =>
        Array.from(element.attributes).filter(attribute => /^on/i.test(attribute.name))
          .map(attribute => ({ tag: element.tagName, name: attribute.name, value: attribute.value }))),
      scripts: Array.from(document.scripts, script => script.src),
      html: document.getElementById('root').innerHTML
    })''')

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
        record(f'{route}: blank dark AgentFlow chat; isolated public entry')
        safe(ctx, page, errors, requests)
    for width in [320, 375, 390, 768, 1440]:
        ctx, page, errors, requests = load(browser, width)
        page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-start-{width}.png'), full_page=True)
        basics(page); send(page, 'type 2 diabetes copd had cancer 7 years ago')
        expect(page.locator('[data-carrier]')).to_have_count(3)
        assert page.locator('[data-question]').count() <= 2
        assert page.locator('[data-fit="green"]').count() == 0
        assert page.get_by_role('button', name='Edit', exact=True).count() == 1
        page.locator('summary').filter(has_text='Picked up').click()
        assert 'Cancer treatment complete' not in page.locator('body').inner_text()
        page.locator('summary').filter(has_text='Picked up').click()
        page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-results-{width}.png'), full_page=True)
        record(f'{width}px: shorthand case, 3 cards, at most 2 questions, no invented treatment end')
        safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    send(page, 'COPD')
    expect(page.get_by_text('Complete the client basics first.', exact=True)).to_be_visible()
    assert page.locator('[data-carrier]').count() == 0
    basics(page); page.locator('#quick-age').fill('65.5'); send(page, 'COPD')
    assert page.locator('[data-carrier]').count() == 0
    record('Zod blocks absent and malformed basics')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page, 'former'); send(page, 'COPD')
    assert page.locator('[data-carrier]').count() == 0
    page.locator('#quick-quit').fill('8'); send(page, 'COPD')
    expect(page.locator('[data-carrier]')).to_have_count(3)
    record('Former nicotine use requires actual duration')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page); send(page, 'takes metfornin')
    expect(page.get_by_text('“metfornin” — did you mean:', exact=True)).to_be_visible()
    assert page.locator('[data-fit="green"]').count() == 0
    page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-medication-confirmation.png'), full_page=True)
    page.get_by_role('button', name='Metformin', exact=True).click()
    expect(page.get_by_text('“metfornin” — did you mean:', exact=True)).to_have_count(0)
    page.locator('summary').filter(has_text='Picked up').click()
    expect(page.get_by_role('button', name='Remove Metformin', exact=True)).to_have_count(1)
    assert page.get_by_role('button', name='Remove Diabetes', exact=True).count() == 0
    record('Medication typo requires confirmation and never establishes a diagnosis')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page); send(page, 'COPD')
    answer(page, 'oxygen', 'No'); answer(page, 'care', 'No'); answer(page, 'recent', 'No'); answer(page, 'complete', 'Nothing else')
    expect(page.locator('[data-carrier="transamerica"]')).to_have_attribute('data-fit', 'green')
    expect(page.locator('[data-carrier="americo"]')).to_have_attribute('data-fit', 'yellow')
    expect(page.locator('[data-carrier="mutual"]')).to_have_attribute('data-fit', 'yellow')
    expect(page.get_by_text('Commission order is pending your verified schedules. No payout ranking is assumed.', exact=True)).to_be_visible()
    page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-green-screen.png'), full_page=True)
    record('Stated preliminary screen versus source gaps; no invented commission')
    send(page, 'on oxygen')
    expect(page.locator('[data-carrier="americo"]')).to_have_attribute('data-fit', 'red')
    assert page.locator('[data-fit="green"]').count() == 0
    page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-updated-results.png'), full_page=True)
    record('Adverse correction invalidates previous green')
    page.get_by_role('button', name='Edit', exact=True).click(); page.locator('#quick-age').fill('')
    assert page.locator('[data-carrier]').count() == 0
    page.locator('#quick-age').fill('90'); expect(page.locator('[data-fit="red"]')).to_have_count(3)
    record('Basics corrections recompute or invalidate results')
    page.get_by_role('button', name='New case', exact=True).click()
    expect(page.locator('#quick-age')).to_have_value(''); expect(page.locator('#quick-note')).to_have_value('')
    assert page.locator('[data-carrier]').count() == 0
    record('New case clears session')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page); send(page, 'COPD'); answer(page, 'oxygen', 'Not sure')
    assert page.locator('[data-question="oxygen"]').count() == 0
    assert page.locator('[data-fit="green"]').count() == 0
    record('Unknown is not No; no repeated prompt trap')
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    expect(page.locator('#quick-note')).to_have_count(0)
    page.evaluate("window.dispatchEvent(new Event('pageshow'))")
    expect(page.locator('#quick-age')).to_have_value(''); expect(page.locator('#quick-note')).to_have_value('')
    assert page.locator('[data-carrier]').count() == 0
    record('Page lifecycle clears health data')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page)
    before = security_snapshot(page)
    payload = '<img src=x onerror="window.pwned=true"> COPD'
    send(page, payload)
    expect(page.locator('[data-carrier]')).to_have_count(3)
    page.wait_for_timeout(250)
    after = security_snapshot(page)
    (OUT / f'security-evidence-{BROWSER}.json').write_text(json.dumps({'source_sha': source_sha, 'script_sha256': script_sha256, 'before': before, 'after': after, 'requests': requests, 'errors': errors}, indent=2))
    page.screenshot(path=str(SHOTS / f'{BROWSER}-chat-literal-input.png'), full_page=True)
    assert not before['sentinelTruthy'], 'Security sentinel present before note'
    assert not after['sentinelTruthy'], 'Unexpected script execution; inspect security evidence'
    assert not page.evaluate('Boolean(window.pwned)')
    assert page.locator('img').count() == 1
    assert not after['eventAttributes'], after['eventAttributes']
    assert '&lt;img' in after['html'], 'Note is not retained as escaped literal text'
    record('Hostile note remains literal; no script, injected element or request')
    page.get_by_role('button', name='New case').click(); basics(page)
    send(page, 'client@example.com has COPD')
    expect(page.get_by_text('Remove the client’s email, phone or identifying numbers. Health details only.', exact=True)).to_be_visible()
    assert page.locator('[data-carrier]').count() == 0
    record('Identifying email format rejected before storing a note')
    safe(ctx, page, errors, requests)
    ctx, page, errors, requests = load(browser)
    basics(page)
    note = page.locator('#quick-note'); note.focus(); expect(note).to_be_focused(); note.fill('COPD')
    note.press('Shift+Enter'); assert page.locator('[data-carrier]').count() == 0
    page.locator('#quick-note').press('Enter'); expect(page.locator('[data-carrier]')).to_have_count(3)
    record('Enter sends; Shift+Enter preserves multiline entry')
    safe(ctx, page, errors, requests)
    browser.close()
complete = True
write_report()
print(json.dumps({'passed': len(checks), 'completed': complete, 'browser': BROWSER, 'source_sha': source_sha}, indent=2))
