'use strict';
const TaskCsv = (() => {
  const types = new Set(['todo', 'daily', 'habit', 'reward']);
  const aliases = {
    toDo: 'todo', todos: 'todo', dailies: 'daily', habits: 'habit', rewards: 'reward',
    '習慣': 'habit', '日課': 'daily', ToDo: 'todo', 'タスク': 'todo', 'ごほうび': 'reward',
  };

  function boolean(value) {
    if (value === '' || value === undefined) return undefined;
    if (['true', '1', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
    if (['false', '0', 'no', 'off'].includes(String(value).toLowerCase())) return false;
    throw Error('真偽値は true/false または 1/0 で指定してください');
  }

  function isValidDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function toTask(raw) {
    const type = Object.hasOwn(aliases, raw.type) ? aliases[raw.type] : raw.type;
    if (!types.has(type)) throw Error('typeが不正です');
    if (!raw.text?.trim()) throw Error('タイトルが空です');
    const task = { type, text: raw.text.trim() };
    if (raw.notes) task.notes = raw.notes;
    if (raw.priority) {
      const priority = Number(raw.priority);
      if (![0.1, 1, 1.5, 2].includes(priority)) throw Error('priorityは 0.1 / 1 / 1.5 / 2');
      task.priority = priority;
    }
    if (raw.date) {
      if (type !== 'todo') throw Error('dateはToDoのみ指定できます');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || !isValidDate(raw.date)) {
        throw Error('dateは実在するYYYY-MM-DD形式の日付を指定してください');
      }
      task.date = raw.date;
    }
    if (type === 'daily') {
      if (raw.frequency) {
        if (!['daily', 'weekly', 'monthly', 'yearly'].includes(raw.frequency)) throw Error('frequencyが不正です');
        task.frequency = raw.frequency;
      }
      if (raw.everyx) {
        const everyX = Number(raw.everyx);
        if (!Number.isSafeInteger(everyX) || everyX < 1) throw Error('everyXは1以上の整数');
        task.everyX = everyX;
      }
      const weekdays = { mon: 'm', tue: 't', wed: 'w', thu: 'th', fri: 'f', sat: 's', sun: 'su' };
      if (Object.keys(weekdays).some(day => raw[day] !== undefined && raw[day] !== '')) {
        if (raw.frequency && raw.frequency !== 'weekly') throw Error('曜日指定にはfrequency=weeklyを使用');
        task.frequency = 'weekly';
        task.repeat = Object.fromEntries(Object.entries(weekdays).map(([day, field]) => [field, boolean(raw[day]) ?? false]));
      }
    }
    if (type === 'habit') {
      for (const field of ['up', 'down']) {
        if (raw[field] !== undefined && raw[field] !== '') task[field] = boolean(raw[field]);
      }
    }
    if (type === 'reward' && raw.value) {
      const value = Number(raw.value);
      if (!Number.isFinite(value) || value < 0) throw Error('valueは0以上の数値');
      task.value = value;
    }
    return task;
  }

  function key(task) {
    return task.type + '\u0000' + task.text.trim().toLocaleLowerCase();
  }

  // 引用符の直後は区切り文字か改行のみ許可する。物理行番号も保持する。
  function parse(source) {
    source = source.replace(/^\uFEFF/, '');
    const records = [];
    let cells = [], field = '', state = 'start', line = 1, recordLine = 1;
    const pushField = () => { cells.push(field); field = ''; state = 'start'; };
    const pushRecord = () => {
      pushField();
      if (cells.some(value => value.trim())) records.push({ cells, line: recordLine });
      cells = [];
    };
    for (let i = 0; i < source.length; i++) {
      const character = source[i];
      if (state === 'quoted') {
        if (character === '"') {
          if (source[i + 1] === '"') { field += '"'; i++; }
          else state = 'closed';
        } else {
          field += character;
          if (character === '\n' || (character === '\r' && source[i + 1] !== '\n')) line++;
        }
      } else if (character === ',') pushField();
      else if (character === '\r' || character === '\n') {
        pushRecord();
        if (character === '\r' && source[i + 1] === '\n') i++;
        line++;
        recordLine = line;
      } else if (character === '"' && state === 'start') state = 'quoted';
      else {
        if (character === '"' || state === 'closed') throw Error(`${line}行目：CSVの引用符の位置が不正です`);
        field += character;
        state = 'plain';
      }
    }
    if (state === 'quoted') throw Error(`${recordLine}行目：CSVの引用符が閉じられていません`);
    pushRecord();
    return records;
  }

  function readTasks(source) {
    const records = parse(source);
    if (records.length < 2) throw Error('ヘッダーとデータ行が必要です');
    const headers = records.shift().cells.map(value => value.trim().toLowerCase());
    if (!headers.includes('type') || !headers.includes('text')) throw Error('type,text列が必要です');
    if (headers.some(header => !header)) throw Error('空の列名があります');
    if (new Set(headers).size !== headers.length) throw Error('列名が重複しています');
    return records.map(({ cells, line }) => {
      const raw = Object.create(null);
      headers.forEach((header, index) => { raw[header] = (cells[index] ?? '').trim(); });
      try {
        if (cells.length > headers.length) throw Error('ヘッダーより列数が多い');
        return { line, raw, task: toTask(raw) };
      } catch (error) {
        return { line, raw, error: error.message };
      }
    });
  }

  return {parse, readTasks, toTask, key};
})();
if (typeof module !== 'undefined') module.exports = TaskCsv;
