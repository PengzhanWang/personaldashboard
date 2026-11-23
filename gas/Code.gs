/**
 * Personal LifeOS Dashboard — Google Apps Script Backend (Phase 1 MVP)
 *
 * Setup:
 * 1. Open your Google Sheet ("LifeOS-Core") -> Extensions -> Apps Script.
 * 2. Paste this file into Code.gs, save, and run `setupSheets()` once.
 * 3. Project Settings -> Script Properties -> Add `HMAC_SECRET` (same value as Worker's `GAS_HMAC_SECRET`).
 * 4. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 * 5. Copy the `/exec` URL into Worker's `GAS_URL` secret.
 */

const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at', 'updated_by', 'version', 'deleted'];

const TABLE_COLUMNS = {
  Projects: SYSTEM_COLUMNS.concat([
    'title', 'area', 'kind', 'status', 'priority', 'start_date', 'target_date',
    'next_action', 'module', 'sensitive', 'doc_url', 'folder_url', 'tags', 'sort',
  ]),
  Tasks: SYSTEM_COLUMNS.concat([
    'title', 'notes', 'project_id', 'status', 'priority', 'due_date', 'remind_at',
    'context', 'sync_calendar', 'calendar_event_id', 'completed_at',
  ]),
};

const LOG_COLUMNS = ['ts', 'device', 'mutation_id', 'table', 'row_id', 'op', 'patch', 'old_values'];
const META_COLUMNS = ['table', 'column', 'type', 'enum_values', 'label_zh', 'required', 'order'];
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Run once manually in the Apps Script editor to initialize sheets, headers, and formatting.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, 'Projects', TABLE_COLUMNS.Projects);
  ensureSheet_(ss, 'Tasks', TABLE_COLUMNS.Tasks);
  ensureSheet_(ss, '_Meta', META_COLUMNS);
  ensureSheet_(ss, '_Log', LOG_COLUMNS);
  Logger.log('LifeOS sheets initialized.');
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  const existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : [];

  if (existing.filter(Boolean).length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sheet.setFrozenRows(1);
  // Format data columns as plain text so dates, IDs and numbers are never mangled by Sheets.
  sheet.getRange(1, 1, sheet.getMaxRows(), Math.max(headers.length, sheet.getLastColumn())).setNumberFormat('@');
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
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
    return jsonOut_({ ok: false, error: 'unknown action: ' + req.action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function buildSnapshot_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    generated_at: Date.now(),
    tables: {
      Projects: readTable_(ss, 'Projects'),
      Tasks: readTable_(ss, 'Tasks'),
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
    const sheetState = {}; // tableName -> { sheet, headers, rows: string[][], idToIndex: Map, dirty: boolean }
    const logRows = [];
    const results = [];
    const now = Date.now();
    const iso = new Date(now).toISOString();

    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (!m || !m.mutation_id || !m.table || !m.row_id) {
        results.push({ mutation_id: (m && m.mutation_id) || '', status: 'error', error: 'invalid mutation' });
        continue;
      }

      // Idempotency check
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
      cache.put(cacheKey, JSON.stringify(res), 21600); // 6 hours
      results.push(res);
    }

    // Batch write back only modified sheets
    Object.keys(sheetState).forEach((name) => {
      const st = sheetState[name];
      if (!st.dirty) return;
      const totalRows = st.rows.length;
      if (totalRows > 0) {
        const range = st.sheet.getRange(2, 1, totalRows, st.headers.length);
        range.setNumberFormat('@');
        range.setValues(st.rows);
      }
    });

    // Append audit log in batch
    if (logRows.length > 0) {
      const logSheet = ss.getSheetByName('_Log') || ensureSheet_(ss, '_Log', LOG_COLUMNS) || ss.getSheetByName('_Log');
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
  if (!sheet) {
    ensureSheet_(ss, tableName, TABLE_COLUMNS[tableName]);
    sheet = ss.getSheetByName(tableName);
  }
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
  const patch = m.op === 'delete' ? { deleted: 'TRUE' } : (m.patch || {});
  let idx = st.idToIndex[m.row_id];
  const overwritten = {};

  if (idx === undefined) {
    if (m.op === 'delete') {
      return { mutation_id: m.mutation_id, status: 'ok' };
    }
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
    if (stale && prevVal !== nextVal) {
      overwritten[k] = prevVal;
    }
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
    JSON.stringify(patch),
    Object.keys(overwritten).length ? JSON.stringify(overwritten) : '',
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
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ providedHex.charCodeAt(i);
  }
  return diff === 0;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
