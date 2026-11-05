'use strict';

const $ = id => document.getElementById(id);
$('auth-help-open').onclick = () => $('auth-help-dialog').showModal();
$('auth-help-close').onclick = () => $('auth-help-dialog').close();
let rows = [];
let busy = false;
let cancel = false;
let fileRevision = 0;
let editingRow = null;
const editableFields = [
  ['type', '種類（todo / daily / habit / reward）'], ['text', 'タイトル'], ['notes', '詳細'],
  ['priority', '難易度（0.1 / 1 / 1.5 / 2）'], ['date', '期限（ToDo・YYYY-MM-DD）'],
  ['frequency', '繰り返し（日課・daily / weekly / monthly / yearly）'],
  ['everyx', '繰り返し間隔 everyX（日課・1以上の整数）'],
  ['mon', '月曜日'], ['tue', '火曜日'], ['wed', '水曜日'], ['thu', '木曜日'],
  ['fri', '金曜日'], ['sat', '土曜日'], ['sun', '日曜日'],
  ['up', 'プラスを有効にする（習慣）'], ['down', 'マイナスを有効にする（習慣）'],
  ['value', '必要なゴールド（ごほうび）'],
];

function render() {
  $('preview').replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const values = [row.line, row.task?.type ?? row.raw.type, row.task?.text ?? row.raw.text,
      row.task?.notes ?? '', row.error ?? 'OK'];
    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (index === 4 && row.error) td.className = 'error';
      tr.append(td);
    });
    const actions = document.createElement('td');
    for (const [label, handler] of [['編集', () => openEditor(row)], ['削除', () => deleteRow(row)]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-label', `${row.line}行目を${label}`);
      button.disabled = busy;
      button.onclick = handler;
      actions.append(button);
    }
    tr.append(actions);
    $('preview').append(tr);
  }
  const errors = rows.filter(row => row.error).length;
  if (rows.length) $('summary').textContent = `${rows.length}件読み込み・正常 ${rows.length - errors}件・エラー ${errors}件`;
  $('upload').disabled = busy || editingRow !== null || !rows.length || errors > 0;
  for (const id of ['file', 'uid', 'token', 'dedupe', 'within', 'test']) $(id).disabled = busy;
  $('stop').disabled = !busy;
}

function clearPreviousResult() {
  $('results').textContent = '';
  $('status').textContent = '';
}

function openEditor(row) {
  if (busy) return;
  editingRow = row;
  $('edit-fields').replaceChildren();
  $('edit-error').textContent = '';
  $('editor-title').textContent = `${row.line}行目の登録内容を編集`;
  for (const [field, title] of editableFields) {
    const label = document.createElement('label');
    label.htmlFor = `edit-${field}`;
    label.textContent = title;
    const input = document.createElement(field === 'notes' ? 'textarea' : 'input');
    input.id = `edit-${field}`;
    input.name = field;
    input.value = row.raw[field] ?? '';
    if (input.tagName === 'INPUT') input.type = 'text';
    if (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'up', 'down'].includes(field)) {
      input.placeholder = 'true / false または 1 / 0（空欄可）';
    }
    $('edit-fields').append(label, input);
  }
  render();
  $('editor').showModal();
}

$('edit-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !editingRow) return;
  const raw = Object.assign(Object.create(null), editingRow.raw);
  for (const [field] of editableFields) raw[field] = $(`edit-${field}`).value.trim();
  try {
    const task = TaskCsv.toTask(raw);
    Object.assign(editingRow, { raw, task });
    delete editingRow.error;
    clearPreviousResult();
    closeEditor();
  } catch (error) {
    $('edit-error').textContent = error.message;
  }
});
function closeEditor() {
  editingRow = null;
  $('editor').close();
  render();
}
$('edit-cancel').onclick = closeEditor;
$('editor').addEventListener('close', () => {
  if (!$('editor').open) { editingRow = null; render(); }
});

function deleteRow(row) {
  if (busy || !confirm(`${row.line}行目「${row.raw.text || 'タイトルなし'}」を登録対象から削除しますか？`)) return;
  rows = rows.filter(candidate => candidate !== row);
  clearPreviousResult();
  if (!rows.length) $('summary').textContent = '登録対象はありません。';
  render();
}

$('file').addEventListener('change', async event => {
  const revision = ++fileRevision;
  rows = [];
  $('summary').textContent = '';
  $('results').textContent = '';
  $('status').textContent = '';
  render();
  const file = event.target.files[0];
  if (!file) return;
  try {
    // 不正なUTF-8を置換したまま登録しない。
    const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (revision !== fileRevision) return;
    rows = TaskCsv.readTasks(source);
  } catch (error) {
    if (revision !== fileRevision) return;
    $('summary').textContent = error instanceof TypeError ? 'UTF-8形式のCSVを選択してください。' : error.message;
  }
  render();
});

function auth() {
  const id = $('uid').value.trim();
  const token = $('token').value.trim();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || !token) {
    throw Error('User ID（UUID形式）とAPI Tokenを入力してください');
  }
  return { 'x-api-user': id, 'x-api-key': token, 'x-client': id + '-CSVUploader', 'Content-Type': 'application/json' };
}

async function api(path, headers, method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch('https://habitica.com/api/v3/' + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', signal: controller.signal,
    });
    let json;
    try { json = await response.json(); }
    catch { throw Error(`APIからJSON応答がありません (HTTP ${response.status})`); }
    // APIのメッセージをそのまま表示しない（認証情報等の反射を防ぐ）。
    if (!response.ok || json?.success !== true || json.data == null) {
      throw Error(`APIの成功応答を確認できません (HTTP ${response.status})`);
    }
    return json.data;
  } catch (error) {
    if (controller.signal.aborted) throw Error('通信がタイムアウトしました。');
    if (error instanceof TypeError) throw Error('通信に失敗しました。ネットワークとブラウザの通信制限を確認してください。');
    throw error;
  } finally { clearTimeout(timeout); }
}

$('test').onclick = async () => {
  if (busy) return;
  busy = true;
  render();
  $('stop').disabled = true;
  $('connection').textContent = '接続中…';
  try {
    const data = await api('user', auth());
    if (typeof data !== 'object' || Array.isArray(data)) throw Error('ユーザー情報の応答形式が不正です');
    $('connection').textContent = '接続成功：' + (data.profile?.name || data.auth?.local?.username || '認証OK');
    $('connection').className = 'ok';
  } catch (error) {
    $('connection').textContent = '接続失敗：' + error.message;
    $('connection').className = 'error';
  } finally { busy = false; render(); }
};

for (const id of ['uid', 'token']) $(id).addEventListener('input', () => {
  $('connection').textContent = '';
  $('connection').className = '';
});

$('stop').onclick = () => {
  cancel = true;
  $('status').textContent = '中止要求を受け付けました。進行中のリクエストは完了する場合があります。';
};

$('upload').onclick = async () => {
  if (busy || !rows.length || rows.some(row => row.error)) return;
  const items = rows.map(row => row.task);
  if (!confirm(`${items.length}件のCSVを確認しました。Habiticaへ登録処理を開始しますか？`)) return;
  busy = true;
  cancel = false;
  render();
  $('results').textContent = '';
  const log = [];
  let posted = false;
  try {
    const headers = auth();
    const seen = new Set();
    let send = items.filter(task => {
      const key = TaskCsv.key(task);
      if ($('within').checked && seen.has(key)) { log.push('スキップ（CSV内重複）：' + task.text); return false; }
      seen.add(key);
      return true;
    });
    if ($('dedupe').checked) {
      $('status').textContent = '既存タスクを取得しています…';
      const existing = await api('tasks/user', headers);
      if (!Array.isArray(existing) || existing.some(task => !task || typeof task.type !== 'string' || typeof task.text !== 'string')) {
        throw Error('既存タスク一覧の応答形式が不正です');
      }
      const keys = new Set(existing.map(TaskCsv.key));
      send = send.filter(task => {
        if (keys.has(TaskCsv.key(task))) { log.push('スキップ（既存）：' + task.text); return false; }
        return true;
      });
    }
    if (cancel) { $('status').textContent = '登録前に中止しました。'; return; }
    if (!send.length) { $('status').textContent = '新規登録するタスクはありません。'; return; }
    if (!confirm(`${send.length}件を新規登録します。続行しますか？`)) {
      $('status').textContent = '登録前に中止しました。'; return;
    }
    $('status').textContent = `${send.length}件を一括送信中…`;
    posted = true;
    const result = await api('tasks/user', headers, 'POST', send);
    log.push(`APIが成功を返しました。送信件数：${send.length}件／応答件数：${Array.isArray(result) ? result.length : '不明'}`);
    $('status').textContent = 'APIが成功を返しました。Habiticaで登録内容を確認してください。';
  } catch (error) {
    log.push('エラー：' + error.message);
    if (posted) log.push('登録済みか不明なことがあります。再送前にHabiticaで確認してください。');
    $('status').textContent = '処理を完了できませんでした。';
  } finally {
    $('results').textContent = log.join('\n');
    busy = false;
    render();
  }
};
