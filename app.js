/* app.js — UI + Google Sheets API calls. No backend. Token lives in memory only. Scope: drive.file (only files this app created). */
(function () {
  'use strict';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  var PORTAL = 'https://services.gst.gov.in/services/trackstatus';
  var LS = { cid: 'gst.clientId', sid: 'gst.sheetId' };
  var S = { token: null, exp: 0, rows: [], client: null, clientFor: '', filter: 'all', q: '' };

  // ---------- helpers
  var $ = function (s) { return document.querySelector(s); };
  function h(tag, attrs) {
    var e = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') e.className = v; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
    });
    [].concat.apply([], kids).forEach(function (c) { if (c == null || c === false) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  var toastT;
  function toast(m) { var t = $('#toast'); t.textContent = m; t.className = 'on'; clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, 4500); }
  function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return iso || ''; return m[3] + '-' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + '-' + m[1]; }
  function clientId() { return localStorage.getItem(LS.cid) || (window.GST_CONFIG && window.GST_CONFIG.CLIENT_ID) || ''; }
  function sheetId() { return localStorage.getItem(LS.sid) || ''; }
  function today() { return istNow().slice(0, 10); }

  // ---------- auth (Google Identity Services token flow; no secrets, no refresh tokens stored)
  function waitGoogle() {
    return new Promise(function (res) {
      var n = 0; (function t() { if (window.google && google.accounts && google.accounts.oauth2) return res(true); if (++n > 40) return res(false); setTimeout(t, 250); })();
    });
  }
  async function connect() {
    var cid = clientId();
    if (!cid) return openSettings('Paste your OAuth Client ID first (see README).');
    if (!(await waitGoogle())) return toast('Google sign-in script could not load (offline or blocked).');
    if (!S.client || S.clientFor !== cid) {
      S.client = google.accounts.oauth2.initTokenClient({ client_id: cid, scope: SCOPE, callback: onToken,
        error_callback: function (e) { toast('Sign-in was cancelled or blocked' + (e && e.type ? ' (' + e.type + ')' : '') + '.'); } });
      S.clientFor = cid;
    }
    S.client.requestAccessToken({ prompt: '' });
  }
  function onToken(r) {
    if (!r || r.error) return toast('Google sign-in failed: ' + ((r && (r.error_description || r.error)) || 'unknown'));
    S.token = r.access_token; S.exp = Date.now() + ((r.expires_in || 3600) - 60) * 1000;
    updateConn(); start();
  }
  function updateConn() {
    var on = !!S.token && Date.now() < S.exp;
    $('#conn').textContent = on ? 'Connected (session in memory only)' : 'Not connected';
    $('#btnConnect').textContent = on ? 'Reconnect' : 'Connect Google';
  }
  async function api(url, o) {
    o = o || {};
    if (!S.token || Date.now() > S.exp) { S.token = null; updateConn(); throw new Error('Session expired - click "Connect Google".'); }
    var res = await fetch(url, { method: o.method || 'GET', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: Object.assign({ Authorization: 'Bearer ' + S.token }, o.body ? { 'Content-Type': 'application/json' } : {}), body: o.body ? JSON.stringify(o.body) : undefined });
    var j = null; try { j = await res.json(); } catch (_) {}
    if (!res.ok) { if (res.status === 401) { S.token = null; updateConn(); } throw new Error((j && j.error && j.error.message) || ('HTTP ' + res.status)); }
    return j;
  }
  function vr(range) { return BASE + '/' + sheetId() + '/values/' + encodeURIComponent(range); }

  // ---------- create the NEW spreadsheet (this app's own file; never touches any other sheet)
  function rgb(hex) { return { red: parseInt(hex.substr(1, 2), 16) / 255, green: parseInt(hex.substr(3, 2), 16) / 255, blue: parseInt(hex.substr(5, 2), 16) / 255 }; }
  async function createTracker() {
    var meta = await api(BASE, { method: 'POST', body: { properties: { title: 'GST Registration & Amendment Tracker', timeZone: 'Asia/Kolkata' },
      sheets: [{ properties: { title: 'Tracker', gridProperties: { frozenRowCount: 1, frozenColumnCount: 2, rowCount: 2000, columnCount: 23 } } },
        { properties: { title: 'Audit Log', gridProperties: { frozenRowCount: 1 } } }, { properties: { title: 'Case History', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Dashboard' } }] } });
    var id = meta.spreadsheetId, ids = {}; meta.sheets.forEach(function (s) { ids[s.properties.title] = s.properties.sheetId; });
    var T = ids['Tracker'], R = [];
    var color = { auto: '#d9d9d9', user: '#cfe2f3', derived: '#e6e6e6', portal: '#d9ead3', helper: '#fff2cc' };
    function rng(c0, c1, r0) { var g = { sheetId: T, startRowIndex: r0 == null ? 1 : r0, startColumnIndex: c0, endColumnIndex: c1 }; return g; }
    R.push({ updateCells: { start: { sheetId: T, rowIndex: 0, columnIndex: 0 }, fields: 'userEnteredValue,note',
      rows: [{ values: HEADERS.map(function (x) { return { userEnteredValue: { stringValue: x.t }, note: x.n }; }) }] } });
    HEADERS.forEach(function (x, i) {
      R.push({ repeatCell: { range: rng(i, i + 1, 0), fields: 'userEnteredFormat(backgroundColor,textFormat,wrapStrategy,verticalAlignment)',
        cell: { userEnteredFormat: { backgroundColor: rgb(color[x.k]), textFormat: { bold: true }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } } } });
    });
    function nf(c0, c1, type, pattern) { R.push({ repeatCell: { range: { sheetId: T, startRowIndex: 1, startColumnIndex: c0, endColumnIndex: c1 }, fields: 'userEnteredFormat.numberFormat', cell: { userEnteredFormat: { numberFormat: { type: type, pattern: pattern } } } } }); }
    nf(9, 16, 'DATE', 'dd-mmm-yyyy'); nf(21, 22, 'DATE_TIME', 'dd-mmm-yyyy hh:mm'); nf(7, 8, 'TEXT', '@'); nf(19, 20, 'TEXT', '@');
    R.push({ setBasicFilter: { filter: { range: { sheetId: T, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 23 } } } });
    R.push({ updateDimensionProperties: { range: { sheetId: T, dimension: 'COLUMNS', startIndex: 0, endIndex: 23 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } });
    R.push({ updateDimensionProperties: { range: { sheetId: T, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 60 }, fields: 'pixelSize' } });
    R.push({ updateDimensionProperties: { range: { sheetId: T, dimension: 'COLUMNS', startIndex: 22, endIndex: 23 }, properties: { pixelSize: 320 }, fields: 'pixelSize' } });
    function list(c, items, strict) { R.push({ setDataValidation: { range: rng(c, c + 1), rule: { strict: strict, showCustomUi: true, condition: { type: 'ONE_OF_LIST', values: items.map(function (v) { return { userEnteredValue: v }; }) } } } }); }
    function formula(c, f, msg) { R.push({ setDataValidation: { range: rng(c, c + 1), rule: { strict: true, inputMessage: msg, condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] } } } }); }
    list(4, ['Registration', 'Amendment'], true); list(16, ['Yes', 'No', 'Pending', 'Not Applicable'], false);
    list(20, ['Ready to Track', 'Invalid ARN', 'Duplicate ARN', 'Tracked', 'Tracked (partial)', 'Extraction Failed'], false);
    formula(7, '=AND(REGEXMATCH(UPPER(TRIM(H2)),"^[A-Z0-9]{15}$"),COUNTIF($H$2:$H,H2)=1)', 'ARN: 15 letters/digits, unique.');
    formula(19, '=OR(T2="",REGEXMATCH(UPPER(TRIM(T2)),"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"))', '15-character GSTIN or blank.');
    var idx = 0;
    function cf(c, f, bg, fg) { R.push({ addConditionalFormatRule: { index: idx++, rule: { ranges: [rng(c, c + 1)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: f }] },
      format: { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg) } } } } } }); }
    cf(6, '=REGEXMATCH(LOWER($G2),"approved")', '#b7e1cd', '#0b5394'); cf(6, '=REGEXMATCH(LOWER($G2),"rejected")', '#f4c7c3', '#990000');
    cf(6, '=REGEXMATCH(LOWER($G2),"scn")', '#fce8b2', '#7f6000'); cf(6, '=REGEXMATCH(LOWER($G2),"clarification")', '#c9daf8', '#1c4587');
    cf(12, '=AND($M2<>"",$M2<TODAY(),$N2="",NOT(REGEXMATCH(LOWER($G2),"approved|rejected")))', '#ea9999', '#660000');
    cf(7, '=AND($H2<>"",COUNTIF($H$2:$H,$H2)>1)', '#ea9999', '#660000');
    cf(20, '=OR($U2="Invalid ARN",$U2="Duplicate ARN",$U2="Extraction Failed")', '#f4c7c3', '#990000'); cf(20, '=$U2="Ready to Track"', '#d9ead3', '#274e13');
    R.push({ repeatCell: { range: { sheetId: ids['Audit Log'], startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, fields: 'userEnteredFormat.numberFormat', cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd-mmm-yyyy hh:mm:ss' } } } } });
    R.push({ repeatCell: { range: { sheetId: ids['Case History'], startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }, fields: 'userEnteredFormat.numberFormat', cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd-mmm-yyyy' } } } } });
    await api(BASE + '/' + id + ':batchUpdate', { method: 'POST', body: { requests: R } });

    var t = 'Tracker!', notDone = t + 'G2:G,"<>*approved*",' + t + 'G2:G,"<>*rejected*"';
    var dash = [['GST Registration & Amendment Tracker - Dashboard', ''], ['(live formulas on the Tracker sheet)', ''], ['Total ARNs', '=COUNTA(' + t + 'H2:H)'],
      ['Not yet tracked (no portal status)', '=B3-COUNTIFS(' + t + 'H2:H,"<>",' + t + 'G2:G,"<>")'],
      ['Pending (tracked, not approved/rejected)', '=COUNTIFS(' + t + 'H2:H,"<>",' + t + 'G2:G,"<>",' + notDone + ')'],
      ['Approved', '=COUNTIFS(' + t + 'H2:H,"<>",' + t + 'G2:G,"*approved*")'], ['Rejected', '=COUNTIFS(' + t + 'H2:H,"<>",' + t + 'G2:G,"*rejected*")'],
      ['Overdue (reply due date passed, no REG-4 filed, not closed)', '=COUNTIFS(' + t + 'H2:H,"<>",' + t + 'M2:M,"<>",' + t + 'M2:M,"<"&TODAY(),' + t + 'N2:N,"",' + notDone + ')'],
      ['', ''], ['Registrations', '=COUNTIFS(' + t + 'H2:H,"<>",' + t + 'E2:E,"Registration")'], ['Amendments', '=COUNTIFS(' + t + 'H2:H,"<>",' + t + 'E2:E,"Amendment")'],
      ['Rows needing attention', '=COUNTIF(' + t + 'U2:U,"Invalid ARN")+COUNTIF(' + t + 'U2:U,"Duplicate ARN")+COUNTIF(' + t + 'U2:U,"Extraction Failed")']];
    await api(BASE + '/' + id + '/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'USER_ENTERED', data: [
      { range: 'Audit Log!A1:G1', values: [['Timestamp', 'ARN', 'Changed Field', 'Old Value', 'New Value', 'Source', 'User']] },
      { range: 'Case History!A1:D1', values: [['ARN', 'Status (as on portal)', 'Date', 'First Recorded At']] },
      { range: 'Dashboard!A1:B12', values: dash },
      { range: 'Dashboard!D2:D3', values: [['Overdue ARNs'], ['=IFERROR(FILTER(' + t + 'H2:H,' + t + 'H2:H<>"",' + t + 'M2:M<>"",' + t + 'M2:M<TODAY(),' + t + 'N2:N="",NOT(REGEXMATCH(LOWER(' + t + 'G2:G),"approved|rejected"))),"None")']] }] } });
    localStorage.setItem(LS.sid, id);
    return id;
  }

  // ---------- data access
  async function load() {
    var r = await api(vr('Tracker!A2:W') + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    S.rows = (r.values || []).map(function (v, i) { return parseRow(v, i + 2); }).filter(function (o) { return o.arn || o.name; });
    render(); return S.rows;
  }
  function writeRow(o) {
    return api(vr('Tracker!A' + o.row + ':W' + o.row) + '?valueInputOption=USER_ENTERED', { method: 'PUT', body: { values: [toValues(o)] } });
  }
  function appendTo(sheet, cols, rows) {
    if (!rows.length) return Promise.resolve();
    return api(vr(sheet + '!A:' + cols) + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { method: 'POST', body: { values: rows } });
  }
  function appendAudit(list) {
    var ts = istNow();
    return appendTo('Audit Log', 'G', list.map(function (a) { return [ts, a.arn, a.field, sheetText(a.old), sheetText(a.new), a.source, 'Tracker app']; }));
  }
  async function readHistory() {
    var r = await api(vr('Case History!A2:C') + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    return (r.values || []).map(function (v) { return { arn: normalizeArn(v[0]), status: String(v[1] || ''), date: typeof v[2] === 'number' ? serialToIso(v[2]) : String(v[2] || '') }; });
  }
  function nextRow() { return S.rows.length ? Math.max.apply(null, S.rows.map(function (r) { return r.row; })) + 1 : 2; }

  async function saveForm(existing, inp) {
    await load();
    var ex = null;
    if (existing) { ex = S.rows.filter(function (r) { return r.row === existing.row; })[0]; if (!ex || ex.arn !== existing.arn) throw new Error('This row changed in the Sheet. Close this window, refresh and try again.'); }
    var errs = validateUser(inp, S.rows, ex ? ex.row : 0);
    if (errs.length) return errs;
    if (!ex) { var b = buildNew(inp, S.rows); b.obj.row = nextRow(); await writeRow(b.obj); await appendAudit(b.audit); }
    else { var e = buildEdit(ex, inp); if (e.changed) { await writeRow(e.obj); await appendAudit(e.audit); } }
    await load(); return [];
  }

  /** Applies JSON copied from the extension ("Copy extracted data"). Same rules as the Apps Script version. */
  async function doImport(text) {
    var req; try { req = JSON.parse(text); } catch (_) { return { ok: false, error: 'That is not valid JSON. Use "Copy extracted data" in the portal banner.' }; }
    var arn = normalizeArn(req && req.arn);
    if (!isValidArn(arn)) return { ok: false, error: 'ARN in the data is not a valid 15-character ARN.' };
    if (req.displayedArn && normalizeArn(req.displayedArn) !== arn) return { ok: false, error: 'ARN shown on the portal differs from the target ARN. Nothing was written.' };
    var calc = computeUpdates(req); if (!calc.ok) return { ok: false, error: calc.error };
    await load();
    var m = S.rows.filter(function (r) { return r.arn === arn; });
    if (!m.length) return { ok: false, error: 'No row has ARN ' + arn + '. Add it with "+ Add ARN" first.' };
    if (m.length > 1) return { ok: false, error: 'ARN ' + arn + ' is in several rows (' + m.map(function (r) { return r.row; }).join(', ') + '). Remove the duplicate first.' };
    var res = applyPortalToRow(m[0], calc, istNow());
    await writeRow(res.obj);
    var seen = {}; (await readHistory()).forEach(function (x) { seen[x.arn + '|' + normStatus(x.status) + '|' + x.date] = 1; });
    var add = []; calc.history.forEach(function (x) { var k = arn + '|' + normStatus(x.status) + '|' + x.date; if (!seen[k]) { seen[k] = 1; add.push([arn, sheetText(x.status), x.date, istNow()]); } });
    await appendTo('Case History', 'D', add);
    await appendAudit(res.audit);
    await load();
    return { ok: true, row: m[0].row, status: res.obj.track, latest: res.latest, changed: res.changed, warnings: res.warnings };
  }

  // ---------- rendering
  var FILTERS = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['overdue', 'Overdue'], ['untracked', 'Not yet tracked'], ['attention', 'Needs attention']];
  function visibleRows() {
    var q = S.q.trim().toLowerCase(), td = today();
    return S.rows.filter(function (o) {
      if (q && [o.arn, o.name, o.group, o.gstin, o.status, o.state].join(' ').toLowerCase().indexOf(q) < 0) return false;
      var f = S.filter; if (f === 'all') return true;
      if (f === 'overdue') return isOverdue(o, td); if (f === 'attention') return needsAttention(o);
      return category(o) === f;
    });
  }
  function render() {
    var d = dashboard(S.rows, today());
    var tiles = [['Total ARNs', d.total, ''], ['Pending', d.pending, 'warn'], ['Approved', d.approved, 'ok'], ['Rejected', d.rejected, 'bad'], ['Overdue', d.overdue, 'bad'], ['Not yet tracked', d.untracked, ''], ['Needs attention', d.attention, 'bad']];
    $('#tiles').replaceChildren.apply($('#tiles'), tiles.map(function (t) { return h('div', { class: 'tile ' + t[2] }, h('b', {}, String(t[1])), h('span', {}, t[0])); }));
    $('#thead').replaceChildren(h('tr', {}, ['Sr', 'Name', 'Group', 'State', 'Type', 'ARN', 'Status of the Application', 'Reply due', 'Last checked', 'Tracking', ''].map(function (x) { return h('th', {}, x); })));
    var vis = visibleRows(), td = today();
    $('#tbody').replaceChildren.apply($('#tbody'), vis.map(function (o) {
      var c = category(o);
      return h('tr', {}, h('td', {}, String(o.sr)), h('td', {}, o.name), h('td', {}, o.group), h('td', {}, o.state), h('td', {}, o.type), h('td', { class: 'arn' }, o.arn),
        h('td', {}, o.status ? h('span', { class: 'badge ' + c }, o.status) : h('span', { class: 'badge untracked' }, 'Not tracked')),
        h('td', { class: isOverdue(o, td) ? 'overdue' : '' }, fmtDate(o.due)), h('td', {}, o.checked),
        h('td', {}, o.track ? h('span', { class: 'badge' + (needsAttention(o) ? ' bad' : '') }, o.track) : ''),
        h('td', {}, h('button', { class: 'sm pri', title: 'Open the GST portal with this ARN', onclick: function () { track(o); } }, 'Track'), ' ',
          h('button', { class: 'sm', onclick: function () { details(o); } }, 'Details'), ' ', h('button', { class: 'sm', onclick: function () { form(o); } }, 'Edit')));
    }));
    $('#count').textContent = vis.length + ' of ' + S.rows.length + ' rows shown. Data is read from your Google Sheet; nothing is stored in this browser.';
    $('#lnkSheet').href = 'https://docs.google.com/spreadsheets/d/' + sheetId() + '/edit';
    $('#setup').hidden = true; $('#app').hidden = false;
  }
  function showSetup() {
    var box = $('#setup'); $('#app').hidden = true; box.hidden = false;
    var on = !!S.token && Date.now() < S.exp, kids = [h('h2', {}, 'Welcome')];
    if (!clientId()) kids.push(h('p', {}, 'Step 1: create a Google OAuth Client ID (see README) and paste it in Settings.'), h('button', { class: 'pri', onclick: function () { openSettings(); } }, 'Open Settings'));
    else if (!on) kids.push(h('p', {}, sheetId() ? 'Connect Google to load your tracker sheet.' : 'Connect Google to create your new tracker sheet.'), h('button', { class: 'pri', onclick: connect }, 'Connect Google'));
    else kids.push(h('p', {}, 'This creates a brand-new spreadsheet in your own Google Drive. The app can only see files it creates itself (drive.file scope); it cannot open any of your other Sheets.'),
      h('button', { class: 'pri', onclick: async function (ev) { ev.target.disabled = true; try { await createTracker(); await load(); toast('New tracker sheet created.'); } catch (e) { ev.target.disabled = false; toast('Could not create the sheet: ' + e.message); } } }, 'Create new tracker sheet'));
    box.replaceChildren.apply(box, kids);
  }
  async function start() { if (!sheetId()) return showSetup(); try { await load(); } catch (e) { showSetup(); toast('Could not load the sheet: ' + e.message); } }

  // ---------- dialogs
  function openDlg(nodes) { var b = $('#dlgBody'); b.replaceChildren.apply(b, nodes); var d = $('#dlg'); if (!d.open) d.showModal(); }
  function closeDlg() { var d = $('#dlg'); if (d.open) d.close(); }
  function track(o) { window.open(PORTAL + '#gsttracker-arn=' + o.arn, '_blank', 'noopener,noreferrer'); }

  function form(ex) {
    var v = ex || {}, f = {};
    function inp(k, label, type, extra) { f[k] = h('input', Object.assign({ type: type || 'text', value: v[k] || '' }, extra || {})); return h('label', {}, label, f[k]); }
    function sel(k, label, opts) { f[k] = h('select', {}, h('option', { value: '' }, '-- choose --'), opts.map(function (o) { return h('option', { value: o, selected: v[k] === o }, o); })); return h('label', {}, label, f[k]); }
    var msg = h('div', { class: 'err' }), save = h('button', { class: 'pri' }, ex ? 'Save changes' : 'Add ARN');
    save.addEventListener('click', async function () {
      var data = {}; Object.keys(f).forEach(function (k) { data[k] = f[k].value; });
      save.disabled = true; msg.textContent = '';
      try { var errs = await saveForm(ex, data); if (errs.length) { msg.textContent = errs.join(' '); save.disabled = false; } else { closeDlg(); toast(ex ? 'Saved.' : 'ARN added.'); } }
      catch (e) { msg.textContent = e.message; save.disabled = false; }
    });
    openDlg([h('h2', {}, ex ? 'Edit ' + ex.arn : 'Add ARN'),
      h('div', { class: 'grid' }, inp('name', 'Name'), inp('group', 'Group'), sel('type', 'Registration OR Amendment', ['Registration', 'Amendment']), inp('arn', 'ARN (15 characters)', 'text', { maxlength: '15', autocapitalize: 'characters' }),
        inp('gstin', 'GSTIN (optional)', 'text', { maxlength: '15' }), inp('due', 'Reply to Notice Due Date', 'date'), sel('aadhaar', 'Aadhaar Authentication', ['Yes', 'No', 'Pending', 'Not Applicable']),
        inp('filedBy', 'Filed by'), inp('bank', 'Bank Account Details / Final Return')),
      h('p', { class: 'mute' }, 'State is filled automatically: GSTIN first, otherwise the state code in the ARN (3rd-4th characters).'), msg,
      h('div', { class: 'acts' }, h('button', { onclick: closeDlg }, 'Cancel'), save)]);
  }

  async function details(o) {
    var kv = h('dl', { class: 'kv' }); KEYS.forEach(function (k) { var val = o[k]; if (k === 'checked' || DATE_KEYS.indexOf(k) >= 0) val = fmtDate(val); kv.append(h('dt', {}, titleOf(k)), h('dd', {}, String(val == null ? '' : val))); });
    var hist = h('div', { class: 'mute' }, 'Loading case history...');
    openDlg([h('h2', {}, 'ARN ' + o.arn), kv, h('h3', {}, 'Case History (all statuses ever read)'), hist, h('div', { class: 'acts' }, h('button', { onclick: closeDlg }, 'Close'))]);
    try {
      var rows = (await readHistory()).filter(function (x) { return x.arn === o.arn; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      hist.replaceChildren(rows.length ? h('ul', {}, rows.map(function (x) { return h('li', {}, fmtDate(x.date) + ' - ' + x.status); })) : 'No history recorded yet.');
    } catch (e) { hist.textContent = 'Could not load history: ' + e.message; }
  }

  function importDlg() {
    var ta = h('textarea', { placeholder: 'Paste the JSON here' }), out = h('div', {}), go = h('button', { class: 'pri' }, 'Import');
    go.addEventListener('click', async function () {
      go.disabled = true; out.replaceChildren(h('div', { class: 'mute' }, 'Working...'));
      try {
        var r = await doImport(ta.value);
        if (!r.ok) out.replaceChildren(h('div', { class: 'err' }, r.error));
        else out.replaceChildren(h('div', { class: r.warnings.length ? 'warnmsg' : 'okmsg' }, 'Row ' + r.row + ' updated (' + r.status + '). Latest status: ' + r.latest + '.' + (r.warnings.length ? ' Notes: ' + r.warnings.join('; ') : '')));
      } catch (e) { out.replaceChildren(h('div', { class: 'err' }, e.message)); }
      go.disabled = false;
    });
    openDlg([h('h2', {}, 'Import portal result'), h('p', { class: 'mute' }, 'On the GST portal, after you click SEARCH, the extension banner shows "Copy extracted data". Paste it here. Only portal-derived columns are updated; your own entries are never overwritten.'),
      ta, out, h('div', { class: 'acts' }, h('button', { onclick: closeDlg }, 'Close'), go)]);
  }

  function openSettings(note) {
    var cid = h('input', { type: 'text', value: clientId(), placeholder: 'xxxx.apps.googleusercontent.com', autocomplete: 'off' });
    openDlg([h('h2', {}, 'Settings'), note ? h('p', { class: 'warnmsg' }, note) : null,
      h('label', {}, 'Google OAuth Client ID (public, not a secret)', cid),
      h('p', { class: 'mute' }, 'Linked sheet: ' + (sheetId() || '(none yet)') + '. This app only works with the sheet it created itself.'),
      h('div', { class: 'acts' },
        h('button', { onclick: function () { localStorage.removeItem(LS.sid); S.rows = []; closeDlg(); showSetup(); toast('Sheet forgotten in this browser (the Google Sheet itself is not deleted).'); } }, 'Forget linked sheet'),
        h('button', { onclick: function () { var t = S.token; S.token = null; updateConn(); if (t && window.google) google.accounts.oauth2.revoke(t, function () { toast('Google access revoked for this session.'); }); closeDlg(); showSetup(); } }, 'Disconnect Google'),
        h('button', { class: 'pri', onclick: function () { var v = cid.value.trim(); if (v) localStorage.setItem(LS.cid, v); else localStorage.removeItem(LS.cid); closeDlg(); toast('Saved.'); showSetup(); } }, 'Save'))]);
  }

  // ---------- init
  function init() {
    $('#btnConnect').addEventListener('click', connect); $('#btnSettings').addEventListener('click', function () { openSettings(); });
    $('#btnAdd').addEventListener('click', function () { form(null); }); $('#btnImport').addEventListener('click', importDlg);
    $('#btnRefresh').addEventListener('click', function () { load().then(function () { toast('Refreshed.'); }).catch(function (e) { toast(e.message); }); });
    $('#q').addEventListener('input', function (e) { S.q = e.target.value; render(); });
    var f = $('#filter'); FILTERS.forEach(function (x) { f.append(h('option', { value: x[0] }, x[1])); }); f.addEventListener('change', function (e) { S.filter = e.target.value; render(); });
    updateConn(); showSetup();
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  window.GSTApp = { S: S, load: load, doImport: doImport, saveForm: saveForm, createTracker: createTracker, render: render, readHistory: readHistory, setToken: function (t) { S.token = t; S.exp = Date.now() + 3600000; updateConn(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
