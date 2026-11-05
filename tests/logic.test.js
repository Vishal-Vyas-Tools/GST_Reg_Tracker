const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = { console }; vm.createContext(ctx);
['core.js', 'logic.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx));
// core.js must stay byte-identical to the audited Apps Script Core.gs
const gs = path.join(root, '..', 'gst-tracker', 'apps-script', 'Core.gs');
let n = 0, fails = [];
const eq = (name, a, b) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${name}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
if (fs.existsSync(gs)) eq('core.js == Core.gs', fs.readFileSync(gs, 'utf8') === fs.readFileSync(path.join(root, 'core.js'), 'utf8'), true);
const L = ctx;
const serial = iso => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000) + 25569;

eq('serial->iso', L.serialToIso(serial('2026-09-18')), '2026-09-18');
eq('sheetText formula guard', [L.sheetText('=1+1'), L.sheetText('+x'), L.sheetText('@a'), L.sheetText('-5'), L.sheetText('ok')], ["'=1+1", "'+x", "'@a", "'-5", 'ok']);
eq('istNow', L.istNow(new Date('2026-11-05T08:30:00Z')), '2026-11-05 14:00:00');
eq('KEYS count', L.KEYS.length, 23);

// parseRow / toValues round trip (dates come back from Sheets as serial numbers)
const vals = [3, 'Acme', 'G1', 'Maharashtra', 'Registration', 'New Registration', 'SCN Raised - X', ' aa2708260078603 ', 'LTU', serial('2026-08-25'), serial('2026-08-25'), serial('2026-09-18'), serial('2026-10-01'), '', '', '', 'Yes', 'V', '=cmd', '', 'Tracked', serial('2026-11-05') + 0.5, 'n'];
const r = L.parseRow(vals, 4);
eq('parse arn/dates', [r.arn, r.reg1, r.reg3, r.due, r.checked, r.sr], ['AA2708260078603', '2026-08-25', '2026-09-18', '2026-10-01', '2026-11-05 12:00', 3]);
eq('toValues guards text', L.toValues(r)[18], "'=cmd");

// validation
const rows = [L.parseRow([1, 'A', '', '', 'Registration', '', '', 'AA2708260078603'], 2)];
const ok = { type: 'Registration', arn: 'aa330826103999q', gstin: '', due: '' };
eq('valid input', L.validateUser(ok, rows, 0), []);
eq('dup arn', L.validateUser({ type: 'Amendment', arn: 'AA2708260078603' }, rows, 0).length, 1);
eq('same row not dup', L.validateUser({ type: 'Amendment', arn: 'AA2708260078603' }, rows, 2), []);
eq('bad arn/gstin/type/date', L.validateUser({ arn: 'SHORT', gstin: '27AAPFU0939F1ZW', type: '', due: '31-02' }, rows, 0).length, 4);

// buildNew: State priority GSTIN > ARN
let b = L.buildNew(ok, rows);
eq('new: sr, track, state from ARN', [b.obj.sr, b.obj.track, b.obj.state, b.obj.arn], [2, 'Ready to Track', 'Tamil Nadu', 'AA330826103999Q']);
b = L.buildNew({ type: 'Amendment', arn: 'AA2708260078603', gstin: '33AAHCS3947E1ZE' }, rows);
eq('new: GSTIN wins over ARN', b.obj.state, 'Tamil Nadu');
// buildEdit
let e = L.buildEdit(r, { type: 'Registration', arn: 'AA2708260078603', gstin: '33AAHCS3947E1ZE', name: 'Acme', group: 'G1', due: '2026-10-01', aadhaar: 'Yes', filedBy: 'V', bank: '=cmd' });
eq('edit: gstin sets state', [e.obj.state, e.obj.track], ['Tamil Nadu', 'Tracked']);
e = L.buildEdit(r, { type: 'Registration', arn: 'AA190426012345X', gstin: '', name: 'Acme', group: 'G1', due: '2026-10-01', aadhaar: 'Yes', filedBy: 'V', bank: '=cmd' });
eq('edit: arn change resets', [e.obj.track, /ARN changed/.test(e.obj.note), e.audit.some(a => a.field === 'ARN')], ['Ready to Track', true, true]);
e = L.buildEdit(r, { type: 'Registration', arn: 'AA2708260078603', gstin: '', name: 'Acme', group: 'G1', due: '2026-10-01', aadhaar: 'Yes', filedBy: 'V', bank: '=cmd' });
eq('edit: nothing changed', e.changed, false);

// portal import
const base = L.buildNew({ type: 'Amendment', arn: 'AA330826103999Q', name: 'Client', group: 'G', due: '2026-10-05' }, []).obj;
const payload = { arn: 'AA330826103999Q', basic: { applicationType: 'Core Amendment Application', assignedTo: 'STATE', date: '2026-08-25', gstin: '33AAHCS3947E1ZE', jurisdiction: '(Tamil Nadu),(CHENNAI CENTRAL)' },
  caseHistory: [{ status: 'ARN Generated \u2013 Pending for Processing', date: '2026-08-25' }, { status: 'SCN Raised \u2013 Pending for Clarification', date: '2026-09-18' }, { status: 'Clarification Not Filed \u2013 Pending for Order', date: '2026-09-29' }] };
const calc = L.computeUpdates(payload);
let a = L.applyPortalToRow(base, calc, '2026-11-05 14:00:00');
eq('import: fields', [a.obj.appType, a.obj.assigned, a.obj.reg1, a.obj.reg2, a.obj.reg3, a.obj.reg4, a.obj.status, a.obj.gstin, a.obj.state, a.obj.track],
  ['Core Amendment Application', 'STATE', '2026-08-25', '2026-08-25', '2026-09-18', '', 'Clarification Not Filed \u2013 Pending for Order', '33AAHCS3947E1ZE', 'Tamil Nadu', 'Tracked']);
eq('import: user fields untouched', [a.obj.name, a.obj.group, a.obj.due, a.obj.type], ['Client', 'G', '2026-10-05', 'Amendment']);
eq('import: category/overdue', [L.category(a.obj), L.isOverdue(a.obj, '2026-11-05'), L.isOverdue(a.obj, '2026-10-01')], ['pending', true, false]);
let a2 = L.applyPortalToRow(a.obj, calc, '2026-11-06 09:00:00');
eq('re-import: no changes logged', [a2.changed.length, a2.audit.filter(x => x.field === 'Portal refresh').length], [0, 1]);
const g2 = L.applyPortalToRow({ ...a.obj, gstin: '27AAPFU0939F1ZV' }, calc, 'x');
eq('gstin mismatch keeps row value + warns', [g2.obj.gstin, g2.warnings.some(w => /differs from the GSTIN/.test(w))], ['27AAPFU0939F1ZV', true]);
const nb = L.applyPortalToRow(L.buildNew({ type: 'Registration', arn: 'AA000826000001A' }, []).obj, L.computeUpdates({ basic: { jurisdiction: '(Kerala),(KOCHI)' }, caseHistory: [{ status: 'SCN Raised', date: '2026-09-18' }] }), 'x');
eq('no gstin, unknown ARN code -> jurisdiction state, partial', [nb.obj.state, nb.obj.track], ['Kerala', 'Tracked (partial)']);
const keep = L.applyPortalToRow(a.obj, L.computeUpdates({ basic: {}, caseHistory: [{ status: 'SCN Raised', date: '2026-09-18' }] }), 'x');
eq('missing page fields never blank cells', [keep.obj.appType, keep.obj.assigned, keep.obj.reg1], ['Core Amendment Application', 'STATE', '2026-08-25']);

// dashboard
const set = [a.obj, L.parseRow([2, 'B', '', '', 'Registration', '', 'Order Issued - Approved', 'AA190426012345X'], 3), L.parseRow([3, 'C', '', '', 'Registration', '', 'Order Issued - Rejected', 'AA190426012346Y'], 4), L.parseRow([4, 'D', '', '', 'Amendment', '', '', 'AA190426012347Z', '', '', '', '', serial('2026-10-01')], 5)];
const d = L.dashboard(set, '2026-11-05');
eq('dashboard', [d.total, d.pending, d.approved, d.rejected, d.untracked, d.overdue, d.registrations, d.amendments], [4, 1, 1, 1, 1, 2, 2, 2]);

console.log(fails.length ? `FAILED ${fails.length}/${n}\n` + fails.join('\n') : `ALL ${n} APP-LOGIC CHECKS PASSED`);
process.exit(fails.length ? 1 : 0);
