/* logic.js — pure row logic for the tracker app (no DOM, no network). Needs core.js loaded first. Unit-tested in Node. */
var KEYS = ['sr', 'name', 'group', 'state', 'type', 'appType', 'status', 'arn', 'assigned', 'reg1', 'reg2', 'reg3', 'due', 'reg4', 'reg5', 'reg6',
  'aadhaar', 'filedBy', 'bank', 'gstin', 'track', 'checked', 'note'];                 // order == columns A:W
var DATE_KEYS = ['reg1', 'reg2', 'reg3', 'due', 'reg4', 'reg5', 'reg6'];
var USER_KEYS = ['name', 'group', 'type', 'arn', 'gstin', 'due', 'aadhaar', 'filedBy', 'bank'];
function titleOf(key) { return HEADERS[KEYS.indexOf(key)].t; }

function serialToIso(n) { return typeof n === 'number' && isFinite(n) ? new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10) : ''; }
function serialToLocal(n) { return new Date(Math.round((n - 25569) * 1440) * 60000).toISOString().slice(0, 16).replace('T', ' '); }
function istNow(d) { return new Date((d || new Date()).getTime() + 19800000).toISOString().slice(0, 19).replace('T', ' '); }

/** Text written to Sheets with USER_ENTERED must not be able to start a formula. */
function sheetText(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function parseRow(vals, row) {
  var o = { row: row };
  KEYS.forEach(function (k, i) {
    var v = vals[i]; if (v == null) v = '';
    if (typeof v === 'number') v = DATE_KEYS.indexOf(k) >= 0 ? serialToIso(v) : k === 'checked' ? serialToLocal(v) : k === 'sr' ? v : String(v);
    else v = String(v).trim();
    o[k] = v;
  });
  o.arn = normalizeArn(o.arn); o.gstin = normalizeGstin(o.gstin);
  return o;
}
function toValues(o) {
  return KEYS.map(function (k) {
    var v = o[k]; if (v == null) return '';
    return (k === 'sr' || DATE_KEYS.indexOf(k) >= 0 || k === 'checked') ? v : sheetText(v);
  });
}

function category(o) { var s = String(o.status || '').toLowerCase(); return /approved/.test(s) ? 'approved' : /rejected/.test(s) ? 'rejected' : s ? 'pending' : 'untracked'; }
function isOverdue(o, todayIso) { var c = category(o); return !!(o.arn && o.due && o.due < todayIso && !o.reg4 && c !== 'approved' && c !== 'rejected'); }
function needsAttention(o) { return o.track === 'Invalid ARN' || o.track === 'Duplicate ARN' || o.track === 'Extraction Failed'; }
function dashboard(rows, todayIso) {
  var d = { total: 0, untracked: 0, pending: 0, approved: 0, rejected: 0, overdue: 0, registrations: 0, amendments: 0, attention: 0 };
  rows.forEach(function (o) {
    if (!o.arn) return; d.total++;
    var c = category(o); d[c]++;
    if (isOverdue(o, todayIso)) d.overdue++;
    if (o.type === 'Registration') d.registrations++; if (o.type === 'Amendment') d.amendments++;
    if (needsAttention(o)) d.attention++;
  });
  return d;
}

function nextSr(rows) { return rows.reduce(function (m, r) { return typeof r.sr === 'number' && r.sr > m ? r.sr : m; }, 0) + 1; }
function findDup(rows, arn, exceptRow) { return rows.filter(function (r) { return r.arn === arn && r.row !== exceptRow; }); }

/** Validates user-entered fields. Returns an array of error strings (empty = OK). */
function validateUser(inp, rows, exceptRow) {
  var e = [], arn = normalizeArn(inp.arn), g = normalizeGstin(inp.gstin);
  if (!arn) e.push('ARN is required.');
  else if (!isValidArn(arn)) e.push('ARN must be exactly 15 letters/digits.');
  else { var d = findDup(rows, arn, exceptRow); if (d.length) e.push('ARN already exists in sheet row ' + d[0].row + '.'); }
  if (g && !isValidGstin(g)) e.push('GSTIN is not valid (format or check digit).');
  if (inp.type !== 'Registration' && inp.type !== 'Amendment') e.push('Choose Registration or Amendment.');
  if (inp.due && !isoOrNull(inp.due)) e.push('Reply-to-notice due date is not a valid date.');
  return e;
}

function buildNew(inp, rows) {
  var o = { row: 0, sr: nextSr(rows), name: String(inp.name || '').trim(), group: String(inp.group || '').trim(), type: inp.type, arn: normalizeArn(inp.arn),
    gstin: normalizeGstin(inp.gstin), due: inp.due || '', aadhaar: String(inp.aadhaar || '').trim(), filedBy: String(inp.filedBy || '').trim(), bank: String(inp.bank || '').trim(),
    state: '', appType: '', status: '', assigned: '', reg1: '', reg2: '', reg3: '', reg4: '', reg5: '', reg6: '', track: 'Ready to Track', checked: '', note: '' };
  var audit = [], src = 'User (app)';
  USER_KEYS.forEach(function (k) { if (o[k]) audit.push({ arn: o.arn, field: titleOf(k), old: '', new: o[k], source: src }); });
  o.state = isValidGstin(o.gstin) ? stateFromGstin(o.gstin) : stateFromArn(o.arn);
  if (o.state) audit.push({ arn: o.arn, field: 'State', old: '', new: o.state, source: isValidGstin(o.gstin) ? 'Derived from GSTIN' : 'Derived from ARN state code' });
  return { obj: o, audit: audit };
}

function buildEdit(ex, inp) {
  var o = Object.assign({}, ex), audit = [], src = 'User (app)';
  var vals = { name: String(inp.name || '').trim(), group: String(inp.group || '').trim(), type: inp.type, arn: normalizeArn(inp.arn), gstin: normalizeGstin(inp.gstin),
    due: inp.due || '', aadhaar: String(inp.aadhaar || '').trim(), filedBy: String(inp.filedBy || '').trim(), bank: String(inp.bank || '').trim() };
  USER_KEYS.forEach(function (k) {
    if (String(o[k]) !== String(vals[k])) { audit.push({ arn: vals.arn || ex.arn, field: titleOf(k), old: ex[k], new: vals[k], source: src }); o[k] = vals[k]; }
  });
  var arnChanged = o.arn !== ex.arn, gChanged = o.gstin !== ex.gstin;
  if (arnChanged) { o.track = 'Ready to Track'; o.note = ex.status ? 'ARN changed: portal-derived columns still show the previous ARN until refreshed.' : ''; }
  var st = o.state;
  if (gChanged) st = isValidGstin(o.gstin) ? stateFromGstin(o.gstin) : stateFromArn(o.arn);
  else if (!st) st = isValidGstin(o.gstin) ? stateFromGstin(o.gstin) : stateFromArn(o.arn);
  if (st !== ex.state) { o.state = st; audit.push({ arn: o.arn, field: 'State', old: ex.state, new: st, source: gChanged ? 'Derived from GSTIN' : 'Derived from ARN state code' }); }
  return { obj: o, audit: audit, changed: audit.length > 0 };
}

/** Same rules as the Sheets/Apps Script version: only portal-derived columns; GSTIN/State only when blank; nothing is ever blanked. */
function applyPortalToRow(ex, calc, now) {
  var o = Object.assign({}, ex), audit = [], changed = [], warnings = calc.warnings.slice(), src = 'Portal result (imported)';
  function set(key, nv, source) {
    var ov = o[key]; if (String(ov) === String(nv)) return;
    o[key] = nv; audit.push({ arn: o.arn, field: titleOf(key), old: ov, new: nv, source: source || src }); changed.push(titleOf(key));
  }
  calc.updates.forEach(function (u) { set(KEYS[u.col - 1], u.value); });
  var curG = o.gstin;
  if (calc.portalGstin) {
    if (!curG) { set('gstin', calc.portalGstin, src + ' - Basic Details'); curG = calc.portalGstin; }
    else if (curG !== calc.portalGstin) warnings.push('GSTIN on portal (' + calc.portalGstin + ') differs from the GSTIN in this row (' + curG + '); row value kept');
  }
  var sNew = '', sSrc = '';
  if (isValidGstin(curG)) { sNew = stateFromGstin(curG); sSrc = 'Derived from GSTIN'; }
  else if (stateFromArn(o.arn)) { sNew = stateFromArn(o.arn); sSrc = 'Derived from ARN state code'; }
  else if (calc.portalState) { sNew = calc.portalState; sSrc = 'Derived from portal Jurisdiction (no GSTIN)'; }
  var curS = String(o.state || '').trim();
  if (sNew && !curS) set('state', sNew, sSrc);
  else if (sNew && curS !== sNew) warnings.push('State in row (' + curS + ') differs from portal-derived State (' + sNew + '); row value kept');
  else if (!sNew && !curS && calc.jurisdictionSeen) warnings.push('State could not be determined from the portal Jurisdiction text');
  if (!changed.length) audit.push({ arn: o.arn, field: 'Portal refresh', old: '', new: 'No changes', source: src });
  var status = calc.complete ? 'Tracked' : 'Tracked (partial)';
  if (o.track !== status) audit.push({ arn: o.arn, field: 'Tracking Status', old: o.track, new: status, source: src });
  o.track = status; o.checked = now; o.note = warnings.join('; ');
  return { obj: o, audit: audit, changed: changed, warnings: warnings, latest: calc.latest.status };
}

if (typeof module !== 'undefined') module.exports = { KEYS: KEYS, parseRow: parseRow, toValues: toValues };
