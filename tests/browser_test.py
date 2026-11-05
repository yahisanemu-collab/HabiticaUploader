"""既存のPlaywrightとChromiumを使用。実APIへの通信はすべてモックする。"""
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    requests = []
    mode = {'value': 'success'}

    def api(route):
        request = route.request
        requests.append((request.method, request.url, request.post_data))
        if mode['value'] == 'network':
            route.abort('failed')
            return
        if mode['value'] == 'http':
            route.fulfill(status=401, json={'success': False, 'message': 'SENSITIVE_RESPONSE'})
            return
        if mode['value'] == 'invalid':
            route.fulfill(json={'success': True, 'data': {'unexpected': True}})
            return
        if request.method == 'POST':
            data = json.loads(request.post_data)
        elif request.url.endswith('/tasks/user'):
            data = [{'type': 'todo', 'text': 'existing'}]
        else:
            data = {'profile': {'name': 'テストユーザー'}}
        route.fulfill(json={'success': True, 'data': data})

    page.route('https://habitica.com/**', api)
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')

    def load(source):
        page.locator('#file').set_input_files({'name': 'test.csv', 'mimeType': 'text/csv', 'buffer': source.encode('utf-8')})
        page.wait_for_function("!document.querySelector('#upload').disabled || document.querySelector('#summary').textContent.length > 0")

    page.locator('#file').set_input_files(str(ROOT / 'sample.csv'))
    page.wait_for_function("document.querySelectorAll('#preview tr').length === 4")
    assert page.locator('#upload').is_enabled()
    with page.expect_download() as download:
        page.locator('a.button').click()
    saved = download.value
    assert saved.suggested_filename == 'HabiticaUploader_sample.csv'
    assert Path(saved.path()).read_bytes() == (ROOT / 'sample.csv').read_bytes()

    load('type,text\ntodo,"unclosed')
    assert '引用符' in page.locator('#summary').inner_text()
    assert page.locator('#upload').is_disabled()
    load('type,text\ntodo,"<img src=x onerror=alert(1)>"')
    assert page.locator('#preview img').count() == 0
    assert '<img' in page.locator('#preview').inner_text()

    page.locator('#uid').fill('11111111-1111-1111-1111-111111111111')
    page.locator('#token').fill('mock-only-not-a-real-token')
    page.locator('#test').click()
    page.wait_for_function("document.querySelector('#connection').textContent.includes('接続成功')")
    assert page.locator('#uid').is_enabled()
    mode['value'] = 'http'
    page.locator('#test').click()
    page.wait_for_function("document.querySelector('#connection').textContent.includes('接続失敗')")
    assert 'HTTP 401' in page.locator('#connection').inner_text()
    assert 'SENSITIVE_RESPONSE' not in page.locator('body').inner_text()
    mode['value'] = 'success'

    load('type,text,everyX\ntodo,existing,\ndaily,new,3\ndaily,NEW,3')
    accept_dialog = lambda dialog: dialog.accept()
    page.on('dialog', accept_dialog)
    page.locator('#upload').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('APIが成功')")
    posts = [json.loads(body) for method, _, body in requests if method == 'POST']
    assert posts == [[{'type': 'daily', 'text': 'new', 'everyX': 3}]]
    assert 'CSV内重複' in page.locator('#results').inner_text()
    assert '既存' in page.locator('#results').inner_text()

    # 編集の検証エラー・取消・保存、および削除後の送信内容を確認。
    load('type,text,everyX\ndaily,before,0\ntodo,remove-me,')
    page.get_by_role('button', name='2行目を編集', exact=True).click()
    page.locator('#edit-everyx').fill('0')
    page.get_by_role('button', name='保存', exact=True).click()
    assert 'everyX' in page.locator('#edit-error').inner_text()
    assert page.locator('#editor').is_visible()
    page.locator('#edit-text').fill('discarded')
    page.locator('#edit-cancel').click()
    page.wait_for_function("!document.querySelector('#editor').open")
    assert 'before' in page.locator('#preview').inner_text()
    assert 'discarded' not in page.locator('#preview').inner_text()
    assert page.locator('#upload').is_disabled()
    page.get_by_role('button', name='2行目を編集', exact=True).click()
    page.locator('#edit-everyx').fill('2')
    page.locator('#edit-text').fill('edited')
    page.locator('#edit-notes').fill('<img src=x onerror=alert(1)>')
    page.get_by_role('button', name='保存', exact=True).click()
    page.wait_for_function("!document.querySelector('#editor').open")
    assert page.locator('#preview img').count() == 0
    assert page.locator('#upload').is_enabled()
    page.get_by_role('button', name='3行目を削除', exact=True).click()
    assert page.locator('#preview tr').count() == 1
    page.locator('#upload').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('APIが成功')")
    posted = [json.loads(body) for method, _, body in requests if method == 'POST'][-1]
    assert posted == [{'type': 'daily', 'text': 'edited', 'notes': '<img src=x onerror=alert(1)>', 'everyX': 2}]
    assert 'remove-me' not in json.dumps(posted)

    mode['value'] = 'invalid'
    post_count = len([request for request in requests if request[0] == 'POST'])
    page.locator('#upload').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('完了できません')")
    assert '応答形式' in page.locator('#results').inner_text()
    assert len([request for request in requests if request[0] == 'POST']) == post_count

    mode['value'] = 'network'
    page.locator('#dedupe').uncheck()
    page.locator('#upload').click()
    page.wait_for_function("document.querySelector('#status').textContent.includes('完了できません')")
    assert '再送前' in page.locator('#results').inner_text()
    assert page.locator('#upload').is_enabled()
    # 確認画面でのキャンセル後に送信しないことを確認。
    page.remove_listener('dialog', accept_dialog)
    dismiss_dialog = lambda dialog: dialog.dismiss()
    page.on('dialog', dismiss_dialog)
    post_count = len([request for request in requests if request[0] == 'POST'])
    page.locator('#upload').click()
    assert len([request for request in requests if request[0] == 'POST']) == post_count
    # 最後の行の削除で登録不可になり、古い件数を残さない。
    page.remove_listener('dialog', dismiss_dialog)
    page.on('dialog', accept_dialog)
    page.get_by_role('button', name='2行目を削除', exact=True).click()
    assert page.locator('#preview tr').count() == 0
    assert page.locator('#upload').is_disabled()
    assert page.locator('#summary').inner_text() == '登録対象はありません。'
    assert '公式資料' not in page.locator('body').inner_text()
    assert 'CSVを確認してからHabiticaへ一括登録します。' not in page.locator('body').inner_text()
    assert page.locator('a[href="https://habitica.com/apidoc/"]').count() == 0
    assert not errors, errors
    browser.close()
    server.shutdown()
    print('PASS: HTTP起動、サンプル保存、CSV表示・エラー・HTML注入対策、接続成功/失敗、重複排除、一括送信、通信失敗')
