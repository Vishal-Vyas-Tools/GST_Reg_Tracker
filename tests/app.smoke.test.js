// Smoke test: loads the real index.html + scripts in jsdom against an in-memory fake of the Google Sheets API.
const { JSDOM } = require('jsdom'); const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const dom = new JSDOM(rd('index.html').replace(/<script[^>]*><\/script>/g, ''), { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const store = { tracker: [], audit: [], hist: [], puts: [], created: 0 };
const serial = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000 + 25569;
function sheetsParse(vals) {           // what Sheets does with USER_ENTERED
  return vals.map((v, i) => {
    if (typeof v !== 'string') return v;
    if (i >= 9 && i <= 15 && /^\d{4}-\d{2}-\d{2}$/.test(v)) return serial(v);
    if (i === 21 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)) return serial(v.slice(0, 10)) + (+v.slice(11, 13) * 3600 + +v.slice(14, 16) * 60) / 86400;
    return v.replace(/^'/, '');
  });
}
w.fetch = async (url, opt) => {
  opt = opt || {}; const m = opt.method || 'GET', u = new URL(url), p = decodeURIComponent(u.pathname), b = opt.body ? JSON.parse(opt.body) : null;
  const ok = j => ({ ok: true, status: 200, json: async () => j });
  if (!/^Bearer /.test(opt.headers.Authorization)) throw new Error('no auth header');
  if (m === 'POST' && p === '/v4/spreadsheets') { store.created++; return ok({ spreadsheetId: 'SID1', sheets: ['Tracker', 'Audit Log', 'Case History', 'Dashboard'].map((t, i) => ({ properties: { title: t, sheetId: i + 1 } })) }); }
  if (p.endsWith(':batchUpdate') || p.endsWith('/values:batchUpdate')) return ok({});
  let r;
  if (m === 'GET' && p.includes('/values/Tracker!A2:W')) return ok({ values: store.tracker });
  if (m === 'PUT' && (r = p.match(/values\/Tracker!A(\d+):W\d+$/))) { store.puts.push(b.values[0]); store.tracker[+r[1] - 2] = sheetsParse(b.values[0]); return ok({}); }
  if (m === 'POST' && p.includes('Audit Log!A:G:append')) { store.audit.push(...b.values); return ok({}); }
  if (m === 'POST' && p.includes('Case History!A:D:append')) { store.hist.push(...b.values.map(v => [v[0], v[1].replace(/^'/, ''), serial(v[2]), v[3]])); return ok({}); }
  if (m === 'GET' && p.includes('Case History!A2:C')) return ok({ values: store.hist });
  throw new Error('unmocked ' + m + ' ' + p);
};
['core.js', 'logic.js', 'config.js', 'app.js'].forEach(f => w.eval(rd(f)));
let n = 0, fails = []; const eq = (name, a, b) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${name}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const A = w.GSTApp, $ = s => w.document.querySelector(s);

(async () => {
  await new Promise(r => setTimeout(r, 50));   // let DOMContentLoaded/init run
  eq('setup panel visible first', [$('#setup').hidden, $('#app').hidden], [false, true]);
  A.setToken('tok');
  await A.createTracker(); await A.load();
  eq('created once, sheet id stored', [store.created, w.localStorage.getItem('gst.sheetId')], [1, 'SID1']);
  eq('app visible, empty', [$('#app').hidden, A.S.rows.length], [false, 0]);

  const base = { type: 'Amendment', arn: 'aa330826103999q', name: '<img src=x onerror=alert(1)>', group: 'G1', due: '2000-01-01', aadhaar: 'Yes', filedBy: 'V', bank: '=HYPERLINK("http://evil","x")', gstin: '' };
  eq('add ok', await A.saveForm(null, base), []);
  eq('row stored', [A.S.rows.length, A.S.rows[0].arn, A.S.rows[0].state, A.S.rows[0].track, A.S.rows[0].row, A.S.rows[0].sr], [1, 'AA330826103999Q', 'Tamil Nadu', 'Ready to Track', 2, 1]);
  eq('formula text neutralised in request', store.puts[0][18], "'=HYPERLINK(\"http://evil\",\"x\")");
  eq('formula text comes back as plain text', A.S.rows[0].bank, '=HYPERLINK("http://evil","x")');
  eq('name rendered as text, no element injected', [$('#tbody').querySelector('img'), $('#tbody').textContent.includes('<img src=x')], [null, true]);
  eq('duplicate rejected', (await A.saveForm(null, { ...base, arn: 'AA330826103999Q' })).length, 1);
  eq('no extra row after reject', A.S.rows.length, 1);
  eq('bad input rejected', (await A.saveForm(null, { type: '', arn: 'x', gstin: 'bad' })).length >= 3, true);

  const payload = { arn: 'AA330826103999Q', displayedArn: 'AA330826103999Q', basic: { applicationType: 'Core Amendment Application', assignedTo: 'STATE', date: '2026-08-25', gstin: '33AAHCS3947E1ZE', jurisdiction: '(Tamil Nadu),(CHENNAI CENTRAL)' },
    caseHistory: [{ status: 'ARN Generated \u2013 Pending for Processing', date: '2026-08-25' }, { status: 'SCN Raised \u2013 Pending for Clarification', date: '2026-09-18' }, { status: 'Clarification Not Filed \u2013 Pending for Order', date: '2026-09-29' }] };
  let r = await A.doImport(JSON.stringify(payload));
  const o = A.S.rows[0];
  eq('import ok', [r.ok, r.status, r.warnings.length], [true, 'Tracked', 0]);
  eq('import fields', [o.appType, o.assigned, o.reg1, o.reg3, o.reg4, o.status, o.gstin], ['Core Amendment Application', 'STATE', '2026-08-25', '2026-09-18', '', 'Clarification Not Filed \u2013 Pending for Order', '33AAHCS3947E1ZE']);
  eq('user fields intact', [o.name, o.group, o.due, o.aadhaar], ['<img src=x onerror=alert(1)>', 'G1', '2000-01-01', 'Yes']);
  eq('history stored once', store.hist.length, 3);
  const auditBefore = store.audit.length;
  r = await A.doImport(JSON.stringify(payload));
  eq('re-import: no dup history, logged as no changes', [store.hist.length, store.audit.slice(auditBefore).some(a => a[2] === 'Portal refresh' && a[4] === 'No changes')], [3, true]);
  eq('mismatch refused', (await A.doImport(JSON.stringify({ ...payload, displayedArn: 'AA190426012345X' }))).ok, false);
  eq('unknown ARN refused', (await A.doImport(JSON.stringify({ ...payload, arn: 'AA190426012345X', displayedArn: undefined }))).ok, false);
  eq('bad json refused', (await A.doImport('not json')).ok, false);
  eq('audit has entries with source', store.audit.some(a => a[1] === 'AA330826103999Q' && /Portal result/.test(a[5])) && store.audit.some(a => /User \(app\)/.test(a[5])), true);

  const tiles = [...$('#tiles').children].map(t => t.querySelector('b').textContent + ' ' + t.querySelector('span').textContent);
  eq('dashboard tiles', [tiles[0], tiles[1], tiles[4]], ['1 Total ARNs', '1 Pending', '1 Overdue']);
  eq('table shows one row with badge', [$('#tbody').children.length, $('#tbody').textContent.includes('Clarification Not Filed')], [1, true]);
  A.S.q = 'zzz'; A.render(); eq('search filters', $('#tbody').children.length, 0);
  A.S.q = ''; A.S.filter = 'approved'; A.render(); eq('status filter', $('#tbody').children.length, 0);
  console.log(fails.length ? `FAILED ${fails.length}/${n}\n` + fails.join('\n') : `ALL ${n} APP SMOKE CHECKS PASSED`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
