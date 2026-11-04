'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { readTasks, parse, key } = require('../csv.js');

test('サンプル全4種類の変換と列の対応', () => {
  const rows = readTasks(readFileSync(`${__dirname}/../sample.csv`, 'utf8'));
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => !row.error));
  assert.equal(rows[0].task.date, '2026-11-15');
  assert.equal(rows[1].task.everyX, 1);
  assert.deepEqual(rows[1].task.repeat, { m: true, t: true, w: true, th: true, f: true, s: false, su: false });
  assert.deepEqual(rows[2].task, { type: 'habit', text: '読書をする', notes: '10分読んだらプラス', priority: 1, up: true, down: false });
  assert.equal(rows[3].task.value, 10);
});
test('everyXの大文字小文字を正規化して検証する', () => {
  assert.equal(readTasks('type,text,everyX\ndaily,test,3')[0].task.everyX, 3);
  for (const value of ['0', '-1', '1.5', 'Infinity', '9007199254740992']) {
    assert.match(readTasks(`type,text,everyX\ndaily,test,${value}`)[0].error, /everyX/);
  }
});
test('BOM・カンマ・引用符・改行・空行と物理行番号', () => {
  const rows = readTasks('\uFEFFtype,text,notes\r\n\r\ntodo,"a,b","line1\r\nline2"\r\nhabit,"say ""hi""",note');
  assert.equal(rows[0].task.text, 'a,b');
  assert.equal(rows[0].task.notes, 'line1\r\nline2');
  assert.equal(rows[1].task.text, 'say "hi"');
  assert.deepEqual(rows.map(row => row.line), [3, 5]);
});
test('不正な引用符とヘッダーを拒否', () => {
  for (const source of ['type,text\ntodo,"a"x', 'type,text\ntodo,a"b', 'type,text\ntodo,"a']) {
    assert.throws(() => parse(source), /引用符/);
  }
  for (const source of ['type,text,\ntodo,a,', 'type,text,TEXT\ntodo,a,b', 'text\na', 'type,text']) {
    assert.throws(() => readTasks(source));
  }
  assert.match(readTasks('type,text\ntodo,a,extra')[0].error, /列数/);
});
test('実在日・真偽値・種類・数値の検証', () => {
  assert.equal(readTasks('type,text,date\ntodo,a,2024-02-29')[0].error, undefined);
  for (const date of ['2025-02-29', '2026-13-01', '0000-01-01']) {
    assert.match(readTasks(`type,text,date\ntodo,a,${date}`)[0].error, /日付/);
  }
  assert.match(readTasks('type,text,up\nhabit,a,maybe')[0].error, /真偽値/);
  assert.match(readTasks('type,text\nconstructor,a')[0].error, /type/);
  assert.match(readTasks('type,text,priority\ntodo,a,3')[0].error, /priority/);
  assert.match(readTasks('type,text,value\nreward,a,-1')[0].error, /value/);
  assert.match(readTasks('type,text\ntodo,')[0].error, /タイトル/);
});
test('重複キーは種類を区別し、タイトルの大文字小文字と前後空白を無視', () => {
  assert.equal(key({ type: 'todo', text: ' Test ' }), key({ type: 'todo', text: 'test' }));
  assert.notEqual(key({ type: 'todo', text: 'test' }), key({ type: 'habit', text: 'test' }));
});
