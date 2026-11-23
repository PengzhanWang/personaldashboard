/**
 * Personal LifeOS Dashboard 2.0 — Google Apps Script Backend (Bento Canvas)
 *
 * Setup / Upgrade:
 * 1. Open "LifeOS-Core" -> 扩展程序 -> Apps 脚本.
 * 2. Replace Code.gs with this file and save (Ctrl+S).
 * 3. Select `setupSheets` and click 运行 (creates Boards & Cards sheets; approves Drive access for image uploads).
 * 4. Click 部署 -> 管理部署 -> 编辑 -> 版本选“新版本” -> 部署 (keeps the exact same /exec URL!).
 */

const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at', 'updated_by', 'version', 'deleted'];

const TABLE_COLUMNS = {
  Boards: SYSTEM_COLUMNS.concat(['title', 'sort', 'sensitive']),
  Cards: SYSTEM_COLUMNS.concat([
    'board_id',
    'tag',
    'title',
    'finish',
    'layout_json',
    'content_md',
    'images_json',
    'links_json',
    'sensitive',
  ]),
};

const LOG_COLUMNS = ['ts', 'device', 'mutation_id', 'table', 'row_id', 'op', 'patch', 'old_values'];
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Run once manually in Apps Script editor to initialize Boards & Cards sheets
 * (and authorize DriveApp for image uploads). Safe to re-run — won't overwrite existing data.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const boardsSheet = ensureSheet_(ss, 'Boards', TABLE_COLUMNS.Boards);
  const cardsSheet = ensureSheet_(ss, 'Cards', TABLE_COLUMNS.Cards);
  ensureSheet_(ss, '_Log', LOG_COLUMNS);

  // Trigger DriveApp authorization & ensure /LifeOS/Uploads exists
  getOrCreateUploadsFolder_();

  // Seed minimal starter data ONLY when Boards is completely empty
  if (boardsSheet.getLastRow() < 2) {
    const iso = new Date().toISOString();
    boardsSheet.getRange(2, 1, 1, TABLE_COLUMNS.Boards.length).setValues([
      ['main', iso, iso, 'setup', '1', 'FALSE', '主画布', '0', 'FALSE'],
    ]);
    if (cardsSheet.getLastRow() < 2) {
      cardsSheet.getRange(2, 1, 2, TABLE_COLUMNS.Cards.length).setValues([
        [
          'starter_list',
          iso,
          iso,
          'setup',
          '1',
          'FALSE',
          'main',
          '清单',
          '随手清单',
          'default',
          JSON.stringify({ x: 0, y: 0, w: 4, h: 2 }),
          '- [ ] 点复选框可直接打勾\n- [ ] 拖住方块空白处换位，拉右下角调大小',
          '[]',
          '[]',
          'FALSE',
        ],
        [
          'starter_note',
          iso,
          iso,
          'setup',
          '1',
          'FALSE',
          'main',
          '笔记',
          '快速开始',
          'warm',
          JSON.stringify({ x: 4, y: 0, w: 4, h: 2 }),
          '点击下方悬浮栏随时新增清单、笔记、图片或关联 Google 文档。',
          '[]',
          JSON.stringify([
            {
              id: 'l_core',
              title: 'LifeOS-Core 数据表',
              kind: 'gsheet',
              url: ss.getUrl(),
            },
          ]),
          'FALSE',
        ],
      ]);
    }
  }
  Logger.log('LifeOS 2.0 Bento sheets & Drive Uploads folder ready.');
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const existing =
    sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
      : [];
  if (existing.filter(Boolean).length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
  sheet
    .getRange(1, 1, sheet.getMaxRows(), Math.max(headers.length, sheet.getLastColumn()))
    .setNumberFormat('@');
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

function getOrCreateUploadsFolder_() {
  const ssFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  const parents = ssFile.getParents();
  const root = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();

  let uploads;
  const it = root.getFoldersByName('Uploads');
  if (it.hasNext()) uploads = it.next();
  else uploads = root.createFolder('Uploads');

  const now = new Date();
  const ym = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  const sub = uploads.getFoldersByName(ym);
  return sub.hasNext() ? sub.next() : uploads.createFolder(ym);
}

/**
 * HTTP POST entry point called by Cloudflare Worker.
 * Query string carries `?sig=<hex_hmac_sha256_of_raw_body>`.
 */
function doPost(e) {
  try {
    const rawBody = (e && e.postData && e.postData.contents) || '';
    const sig = (e && e.parameter && e.parameter.sig) || '';
    const secret = PropertiesService.getScriptProperties().getProperty('HMAC_SECRET') || '';

    if (!secret) return jsonOut_({ ok: false, error: 'HMAC_SECRET not configured in Script Properties' });
    if (!verifyHmac_(secret, rawBody, sig)) return jsonOut_({ ok: false, error: 'invalid signature' });

    const req = JSON.parse(rawBody);
    if (typeof req.ts !== 'number' || Math.abs(Date.now() - req.ts) > MAX_SKEW_MS) {
      return jsonOut_({ ok: false, error: 'request timestamp expired' });
    }

    if (req.action === 'snapshot') {
      return jsonOut_({ ok: true, data: buildSnapshot_() });
    }
    if (req.action === 'mutate') {
      return jsonOut_({ ok: true, data: handleMutate_(req.payload || {}) });
    }
    if (req.action === 'uploadImage') {
      return jsonOut_({ ok: true, data: handleUploadImage_(req.payload || {}) });
    }
    if (req.action === 'getImage') {
      return jsonOut_({ ok: true, data: handleGetImage_(req.payload || {}) });
    }
    return jsonOut_({ ok: false, error: 'unknown action: ' + req.action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function handleUploadImage_(payload) {
  const base64 = String(payload.base64 || '');
  const mimeType = String(payload.mimeType || 'image/webp');
  const filename = String(payload.filename || 'image-' + Date.now() + '.webp').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  if (!base64) throw new Error('empty image data');
  if (base64.length > 4 * 1024 * 1024) throw new Error('image too large (max ~3MB)');

  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const folder = getOrCreateUploadsFolder_();
  const file = folder.createFile(blob);
  return { file_id: file.getId(), size: bytes.length };
}

function handleGetImage_(payload) {
  const fileId = String(payload.file_id || '');
  if (!fileId) throw new Error('missing file_id');
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  return {
    base64: Utilities.base64Encode(blob.getBytes()),
    mimeType: blob.getContentType() || 'image/webp',
  };
}

function buildSnapshot_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    generated_at: Date.now(),
    tables: {
      Boards: readTable_(ss, 'Boards'),
      Cards: readTable_(ss, 'Cards'),
    },
  };
}

function readTable_(ss, tableName) {
  const sheet = ss.getSheetByName(tableName);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const headers = values[0].map((h) => String(h).trim());
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const line = values[i];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = String(line[c] ?? '');
    }
    if (!obj.id || obj.deleted === 'TRUE') continue;
    rows.push(obj);
  }
  return rows;
}

function handleMutate_(payload) {
  const mutations = Array.isArray(payload.mutations) ? payload.mutations.slice(0, 100) : [];
  if (!mutations.length) return { results: [], server_time: Date.now() };

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const cache = CacheService.getScriptCache();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetState = {};
    const logRows = [];
    const results = [];
    const iso = new Date().toISOString();

    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (!m || !m.mutation_id || !m.table || !m.row_id) {
        results.push({ mutation_id: (m && m.mutation_id) || '', status: 'error', error: 'invalid mutation' });
        continue;
      }

      const cacheKey = 'mut:' + m.mutation_id;
      const cached = cache.get(cacheKey);
      if (cached) {
        results.push(JSON.parse(cached));
        continue;
      }

      if (!TABLE_COLUMNS[m.table]) {
        results.push({ mutation_id: m.mutation_id, status: 'error', error: 'unknown table ' + m.table });
        continue;
      }

      if (!sheetState[m.table]) {
        sheetState[m.table] = loadSheetState_(ss, m.table);
      }

      const st = sheetState[m.table];
      const res = applyMutation_(st, m, iso, logRows);
      cache.put(cacheKey, JSON.stringify(res), 21600);
      results.push(res);
    }

    Object.keys(sheetState).forEach((name) => {
      const st = sheetState[name];
      if (!st.dirty) return;
      if (st.rows.length > 0) {
        const range = st.sheet.getRange(2, 1, st.rows.length, st.headers.length);
        range.setNumberFormat('@');
        range.setValues(st.rows);
      }
    });

    if (logRows.length > 0) {
      const logSheet = ss.getSheetByName('_Log') || ensureSheet_(ss, '_Log', LOG_COLUMNS);
      const startRow = logSheet.getLastRow() + 1;
      const logRange = logSheet.getRange(startRow, 1, logRows.length, LOG_COLUMNS.length);
      logRange.setNumberFormat('@');
      logRange.setValues(logRows);
    }

    return { results: results, server_time: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

function loadSheetState_(ss, tableName) {
  let sheet = ss.getSheetByName(tableName);
  if (!sheet) sheet = ensureSheet_(ss, tableName, TABLE_COLUMNS[tableName]);
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), TABLE_COLUMNS[tableName].length);
  const raw = lastRow >= 1 ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [TABLE_COLUMNS[tableName]];
  const headers = raw[0].map((h) => String(h).trim());
  const colIndex = {};
  headers.forEach((h, idx) => {
    if (h) colIndex[h] = idx;
  });

  const rows = [];
  const idToIndex = {};
  const idCol = colIndex.id;
  for (let i = 1; i < raw.length; i++) {
    const line = raw[i].map((v) => String(v ?? ''));
    rows.push(line);
    if (idCol !== undefined && line[idCol]) {
      idToIndex[line[idCol]] = rows.length - 1;
    }
  }
  return { sheet: sheet, headers: headers, colIndex: colIndex, rows: rows, idToIndex: idToIndex, dirty: false };
}

function applyMutation_(st, m, iso, logRows) {
  const allowed = TABLE_COLUMNS[m.table];
  const patch = m.op === 'delete' ? { deleted: 'TRUE' } : m.patch || {};
  let idx = st.idToIndex[m.row_id];
  const overwritten = {};

  if (idx === undefined) {
    if (m.op === 'delete') return { mutation_id: m.mutation_id, status: 'ok' };
    const line = st.headers.map(() => '');
    setCell_(st, line, 'id', m.row_id);
    setCell_(st, line, 'created_at', iso);
    setCell_(st, line, 'version', '0');
    setCell_(st, line, 'deleted', 'FALSE');
    st.rows.push(line);
    idx = st.rows.length - 1;
    st.idToIndex[m.row_id] = idx;
  }

  const line = st.rows[idx];
  const currentVer = Number(getCell_(st, line, 'version') || '0');
  const stale = Number(m.base_version || '0') < currentVer;

  Object.keys(patch).forEach((k) => {
    if (allowed.indexOf(k) === -1) return;
    if (['id', 'created_at', 'version', 'updated_at', 'updated_by'].indexOf(k) !== -1) return;
    const nextVal = String(patch[k] ?? '');
    const prevVal = getCell_(st, line, k);
    if (stale && prevVal !== nextVal) overwritten[k] = prevVal;
    setCell_(st, line, k, nextVal);
  });

  setCell_(st, line, 'version', String(currentVer + 1));
  setCell_(st, line, 'updated_at', iso);
  setCell_(st, line, 'updated_by', String(m.device || 'web'));
  st.dirty = true;

  logRows.push([
    iso,
    String(m.device || 'web'),
    m.mutation_id,
    m.table,
    m.row_id,
    m.op || 'upsert',
    JSON.stringify(patch).slice(0, 2000),
    Object.keys(overwritten).length ? JSON.stringify(overwritten).slice(0, 1000) : '',
  ]);

  const rowObj = {};
  st.headers.forEach((h, c) => {
    if (h) rowObj[h] = line[c];
  });

  const out = { mutation_id: m.mutation_id, status: 'ok', row: rowObj };
  if (Object.keys(overwritten).length) out.overwritten = overwritten;
  return out;
}

function getCell_(st, line, col) {
  const c = st.colIndex[col];
  return c === undefined ? '' : String(line[c] ?? '');
}

function setCell_(st, line, col, val) {
  const c = st.colIndex[col];
  if (c !== undefined) line[c] = val;
}

function verifyHmac_(secret, body, providedHex) {
  if (!providedHex) return false;
  const sigBytes = Utilities.computeHmacSha256Signature(body, secret, Utilities.Charset.UTF_8);
  const expected = sigBytes.map((b) => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
  if (expected.length !== providedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ providedHex.charCodeAt(i);
  return diff === 0;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
