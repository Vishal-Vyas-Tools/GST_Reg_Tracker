/**
 * Core.gs — constants and PURE helpers (no Apps Script services), so they can be unit-tested in Node.
 */
var SHEET = { TRACKER: 'Tracker', AUDIT: 'Audit Log', HISTORY: 'Case History', DASH: 'Dashboard' };
var TZ = 'Asia/Kolkata';
var DATE_FMT = 'dd-mmm-yyyy';
var PORTAL_URL = 'https://services.gst.gov.in/services/trackstatus';

// Column numbers (A=1). The sheet starts in column A: template columns are A:S (1..19); helpers T:W are added after S.
var COL = { SR: 1, NAME: 2, GROUP: 3, STATE: 4, TYPE: 5, APPTYPE: 6, STATUS: 7, ARN: 8, ASSIGNED: 9,
  REG1: 10, REG2: 11, REG3: 12, DUE: 13, REG4: 14, REG5: 15, REG6: 16, AADHAAR: 17, FILEDBY: 18, BANK: 19,
  GSTIN: 20, TRACK: 21, CHECKED: 22, NOTE: 23 };

// Header text is copied from "Format of Tracker.xlsx" (including its spelling "Filling"). Index 0 = column A.
// k: auto | user | derived | portal | helper
var HEADERS = [
  { t: 'Sr. No.', k: 'auto', n: 'Automatic serial number, assigned when an ARN is entered.' },
  { t: 'Name', k: 'user', n: 'Input provided by user.' },
  { t: 'Group', k: 'user', n: 'Input provided by user.' },
  { t: 'State', k: 'derived', n: 'Derived from a valid GSTIN (column T); if none, from the ARN state code (3rd-4th characters); if still unknown, from the portal Jurisdiction text. Blank if none can be determined.' },
  { t: 'Registration OR Amendment', k: 'user', n: 'Input provided by user.' },
  { t: 'Application Type', k: 'portal', n: 'Portal: Basic Details > Application Type.' },
  { t: 'Status of the Application', k: 'portal', n: 'Portal: Case History. Status with the latest date.' },
  { t: 'ARN', k: 'user', n: 'Input provided by user. 15 letters/digits, one row per ARN (amendments too).' },
  { t: 'Application assigned to', k: 'portal', n: 'Portal: Basic Details > Application assigned to.' },
  { t: 'GST Reg-1/14 Filling Date', k: 'portal', n: 'Portal: Basic Details > Date.' },
  { t: 'GST Reg-2 Received Date', k: 'portal', n: 'Same as application date (Basic Details > Date).' },
  { t: 'GST Reg-3 Notice Received Date', k: 'portal', n: 'Portal: Case History date of "SCN Raised".' },
  { t: 'Reply to Notice Due Date', k: 'user', n: 'Input provided by user.' },
  { t: 'GST Reg-4 Filling Date', k: 'portal', n: 'Portal: Case History date of "Clarification Filed - Pending for Order".' },
  { t: 'GST Reg-5 Order of Rejection Received Date', k: 'portal', n: 'Portal: Case History date of "Order Issued - Rejected".' },
  { t: 'GST Reg-6 Issued Date', k: 'portal', n: 'Portal: Case History date of "Order Issued - Approved".' },
  { t: 'Aadhaar Authentication', k: 'user', n: 'Input provided by user.' },
  { t: 'Filed by', k: 'user', n: 'Input provided by user.' },
  { t: 'Bank Account Details/ Final Return', k: 'user', n: 'Input provided by user.' },
  { t: 'GSTIN', k: 'helper', n: 'Helper column (not in the template). Optional; drives State when valid. Not available for brand-new registrations.' },
  { t: 'Tracking Status', k: 'helper', n: 'Script-managed: Ready to Track / Invalid ARN / Duplicate ARN / Tracked / Tracked (partial) / Extraction Failed.' },
  { t: 'Last Checked At', k: 'helper', n: 'Script-managed: time the extension last wrote portal data for this ARN.' },
  { t: 'Tracking Note', k: 'helper', n: 'Script-managed: warnings from the last check (missing fields, same-date statuses...).' }
];

var STATE_CODES = { '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction' };

var ARN_RE = /^[A-Z0-9]{15}$/;
var GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function normalizeArn(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase(); }
function isValidArn(a) { return ARN_RE.test(a); }
function normalizeGstin(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase(); }

function isValidGstin(g) {
  if (!GSTIN_RE.test(g)) return false;
  var cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', sum = 0;
  for (var i = 0; i < 14; i++) {
    var p = cs.indexOf(g.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return cs.charAt((36 - (sum % 36)) % 36) === g.charAt(14);
}
/** State from the ARN: 3rd-4th characters are the state code (e.g. AA27... = Maharashtra). '' if not a known code. */
function stateFromArn(a) {
  a = normalizeArn(a);
  return /^[A-Z]{2}[0-9]{2}/.test(a) ? (STATE_CODES[a.substr(2, 2)] || '') : '';
}
function stateFromGstin(g) { return isValidGstin(g) ? (STATE_CODES[g.substr(0, 2)] || '') : ''; }

/** Returns 'YYYY-MM-DD' if s is exactly a real ISO date, else null. */
function isoOrNull(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
  return (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) ? m[0] : null;
}

// Names the portal may print in the Jurisdiction text -> canonical state/UT name used in the State column.
var STATE_ALIASES = { 'jammu & kashmir': 'Jammu and Kashmir', 'andaman & nicobar islands': 'Andaman and Nicobar Islands', 'andaman & nicobar': 'Andaman and Nicobar Islands',
  'dadra & nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'nct of delhi': 'Delhi', 'pondicherry': 'Puducherry' };
function stateNameMap_() {
  var m = {}; Object.keys(STATE_CODES).forEach(function (k) { m[STATE_CODES[k].toLowerCase()] = STATE_CODES[k]; });
  Object.keys(STATE_ALIASES).forEach(function (k) { m[k] = STATE_ALIASES[k]; });
  return m;
}
/**
 * State from the portal's "State/Centre Jurisdiction" text, e.g. "(Tamil Nadu),(CHENNAI CENTRAL),(Central-I),(ASHOK NAGAR)".
 * 1) the first bracketed group if it is exactly a state/UT name; 2) else a state name appearing as a whole word, only if exactly ONE state is found.
 * Otherwise '' (never guessed).
 */
function stateFromJurisdiction(text) {
  var t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim(), map = stateNameMap_();
  if (!t) return '';
  var first = t.split(/\)\s*,\s*\(/)[0].replace(/^[\s(]+|[\s)]+$/g, '').toLowerCase();
  if (map[first]) return map[first];
  var found = {};
  Object.keys(map).sort(function (a, b) { return b.length - a.length; }).forEach(function (name) {
    var re = new RegExp('(^|[^a-z])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i');
    if (re.test(t)) found[map[name]] = 1;
  });
  var keys = Object.keys(found);
  return keys.length === 1 ? keys[0] : '';
}

function normStatus(s) {
  return String(s == null ? '' : s).replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
// Portal statuses carry suffixes (e.g. "SCN Raised - Pending for Clarification"), so match on the START of the normalised text.
// "Clarification Not Filed - Pending for Order" deliberately does NOT match "clarification filed".
var STAGE_PREFIX = [['scn raised', 'REG3'], ['clarification filed', 'REG4'], ['order issued - rejected', 'REG5'], ['order issued - approved', 'REG6']];
var STAGE_COL = { REG3: COL.REG3, REG4: COL.REG4, REG5: COL.REG5, REG6: COL.REG6 };
var STAGE_RANK = { REG3: 1, REG4: 2, REG5: 3, REG6: 3 };
function stageKey(s) {
  var n = normStatus(s);
  for (var i = 0; i < STAGE_PREFIX.length; i++) if (n.indexOf(STAGE_PREFIX[i][0]) === 0) return STAGE_PREFIX[i][1];
  return null;
}

/**
 * Pure mapping of an extension payload to sheet updates.
 * payload: { arn, basic:{applicationType, assignedTo, date:'YYYY-MM-DD'}, caseHistory:[{status, date:'YYYY-MM-DD'}] }
 * Never invents values: a field is only returned if the portal supplied it.
 */
function computeUpdates(req) {
  var warnings = [], hist = [], bad = 0;
  ((req && req.caseHistory) || []).forEach(function (h) {
    var st = String((h && h.status) || '').replace(/\s+/g, ' ').trim();
    var iso = isoOrNull(h && h.date);
    if (!st || !iso) { bad++; return; }
    var key = stageKey(st);
    hist.push({ status: st, date: iso, key: key, rank: key ? STAGE_RANK[key] : 0 });
  });
  if (bad) warnings.push(bad + ' case-history row(s) skipped (blank status or unreadable date)');
  if (!hist.length) return { ok: false, code: 'NO_HISTORY', error: 'No usable Case History rows were received.' };

  var best = null;
  hist.forEach(function (h) {
    if (!best || h.date > best.date || (h.date === best.date && h.rank > best.rank)) best = h;
  });
  var tied = {};
  hist.forEach(function (h) { if (h.date === best.date) tied[h.status] = 1; });
  if (Object.keys(tied).length > 1) {
    warnings.push('Several statuses share the latest date (' + Object.keys(tied).join(' | ') +
      '); latest chosen by stage order - please verify on the portal');
  }

  var stageDates = {};
  hist.forEach(function (h) { if (h.key && (!stageDates[h.key] || h.date > stageDates[h.key])) stageDates[h.key] = h.date; });

  var b = (req && req.basic) || {};
  var appType = String(b.applicationType || '').replace(/\s+/g, ' ').trim();
  var assigned = String(b.assignedTo || '').replace(/\s+/g, ' ').trim();
  var appDate = isoOrNull(b.date);
  if (!appType) warnings.push('Application Type not found on page');
  if (!assigned) warnings.push('Application assigned to not found on page');
  if (!appDate) warnings.push('Basic Details date not found on page');

  // Portal-supplied GSTIN (only if it passes the format + check-digit test) and State from the Jurisdiction text (used when no valid GSTIN is known)
  var pg = normalizeGstin(b.gstin), portalGstin = '';
  if (pg) { if (isValidGstin(pg)) portalGstin = pg; else warnings.push('GSTIN shown on portal failed the format/check-digit test and was ignored'); }
  var juris = String(b.jurisdiction || '').replace(/\s+/g, ' ').trim();

  var updates = [];
  function put(col, type, value) { if (value) updates.push({ col: col, type: type, value: value }); }
  put(COL.APPTYPE, 'text', appType);
  put(COL.STATUS, 'text', best.status);
  put(COL.ASSIGNED, 'text', assigned);
  put(COL.REG1, 'date', appDate);
  put(COL.REG2, 'date', appDate);
  Object.keys(stageDates).forEach(function (k) { put(STAGE_COL[k], 'date', stageDates[k]); });

  return { ok: true, latest: { status: best.status, date: best.date }, updates: updates, history: hist,
    warnings: warnings, complete: !!(appType && assigned && appDate),
    portalGstin: portalGstin, portalState: stateFromJurisdiction(juris), jurisdictionSeen: !!juris };
}

if (typeof module !== 'undefined') {
  module.exports = { COL: COL, HEADERS: HEADERS, normalizeArn: normalizeArn, isValidArn: isValidArn, isValidGstin: isValidGstin,
    stateFromGstin: stateFromGstin, stateFromArn: stateFromArn, stateFromJurisdiction: stateFromJurisdiction, isoOrNull: isoOrNull, stageKey: stageKey, computeUpdates: computeUpdates, normalizeGstin: normalizeGstin };
}
