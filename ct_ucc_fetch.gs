// CT UCC Filings → Google Sheets (Apps Script)
// Mirrors Make.com blueprint pagination and column mapping.
// Source blueprint: :contentReference[oaicite:0]{index=0}
/*
ASSUMPTIONS
- Writes to the active spreadsheet. Sheet name defaults to 'Raw_UCC' but can be overridden via Script Properties.
- Fetches pages in batches, persisting progress in Script Properties to avoid Apps Script timeouts.
- Socrata App Token is optional. Set 'SOCRATA_APP_TOKEN' in Script Properties for higher limits.
- Filters on dt_accept >= DT_ACCEPT_SINCE (default '2020-08-01T00:00:00').
- DRY_RUN=true skips writing but logs counts. VERBOSE_LOGS=true prints per-page info.

Script Properties (optional):
  SHEET_NAME=Raw_UCC
  DT_ACCEPT_SINCE=2020-08-01T00:00:00
  SOCRATA_APP_TOKEN=your_token
  DRY_RUN=true|false
  VERBOSE_LOGS=true|false
  NEXT_OFFSET=0              # managed automatically to resume pagination
*/

var HEADERS = [
  'id_lien_flng_nbr','id_ucc_flng_nbr','lien_status','cd_flng_type','tx_lien_descript',
  'debtor_nm_bus','debtor_ad_str1','debtor_ad_city','debtor_ad_state','debtor_ad_zip',
  'sec_party_nm_bus','sec_party_ad_str1','sec_party_ad_city','sec_party_ad_state','sec_party_ad_zip',
  'dt_lapse','dt_accept','cd_volume','cd_start_page','qt_pages',
  'debtor_nm_last','debtor_nm_first','debtor_nm_mid','sec_party_ad_str2','sec_party_nm_last','sec_party_nm_first',
  'debtor_ad_str2','debtor_nm_suff','debtor_nm_mid','debtor_nm_pref','sec_party_nm_suff',
  'fileSize','emal','phone_number','Contact','Completed','(AK)','(AL)','(AM)','(AN)','(AO)','(AP)'
];

function run() {
  var propSvc = PropertiesService.getScriptProperties();
  var props = propSvc.getProperties();
  var SHEET_NAME = props.SHEET_NAME || 'Raw_UCC';
  var DT_ACCEPT_SINCE = props.DT_ACCEPT_SINCE || '2020-08-01T00:00:00';
  var APP_TOKEN = props.SOCRATA_APP_TOKEN || '';
  var DRY_RUN = (props.DRY_RUN || 'false').toLowerCase() === 'true';
  var VERBOSE = (props.VERBOSE_LOGS || 'false').toLowerCase() === 'true';

  var PAGE_LIMIT = 1000; // blueprint uses $limit=1000
  var BASE_URL = 'https://data.ct.gov/resource/xfev-8smz.json';
  var MAX_RUNTIME_MS = 5 * 60 * 1000; // stop ~5min to avoid Apps Script timeout

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ensureSheet_(ss, SHEET_NAME, HEADERS);

  var offset = Number(props.NEXT_OFFSET || 0);
  var start = Date.now();
  var total = 0;
  var page = 0;
  var more = true;

  while (more && Date.now() - start < MAX_RUNTIME_MS) {
    var qs = {
      '$where': "dt_accept >= '" + DT_ACCEPT_SINCE + "'",
      '$limit': String(PAGE_LIMIT),
      '$offset': String(offset)
    };
    var res = fetchJson_(BASE_URL, qs, APP_TOKEN, VERBOSE);
    if (!Array.isArray(res)) res = [];
    if (VERBOSE) Logger.log('Page %s: %s rows (offset %s)', page, res.length, offset);

    var rows = res.map(function(rec) { return mapRecordToRow_(rec, HEADERS); });
    total += rows.length;

    if (!DRY_RUN && rows.length) {
      var startRow = Math.max(2, sheet.getLastRow() + 1);
      sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);
    }

    if (res.length < PAGE_LIMIT) {
      more = false;
      propSvc.deleteProperty('NEXT_OFFSET');
    } else {
      offset += PAGE_LIMIT;
      propSvc.setProperty('NEXT_OFFSET', String(offset));
    }

    page++;
  }

  if (VERBOSE) Logger.log('Total rows fetched this run: %s', total);
  if (DRY_RUN) Logger.log('DRY_RUN=true → no rows written.');
}

/* -------------------- Helpers -------------------- */

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  var firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsHeaders = false;
  for (var i = 0; i < headers.length; i++) {
    if (firstRow[i] !== headers[i]) { needsHeaders = true; break; }
  }
  if (needsHeaders) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function mapRecordToRow_(rec, headers) {
  return headers.map(function(key) {
    return safe(rec[key]);
  });
}

function safe(v) {
  return v == null ? '' : String(v);
}

// HTTP with retries and exponential backoff
function fetchJson_(baseUrl, queryParams, appToken, verbose) {
  var url = buildUrl_(baseUrl, queryParams);
  var headers = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;

  var opts = {
    method: 'get',
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: true,
    validateHttpsCertificates: true
  };

  var attempts = 0, maxAttempts = 3, wait = 500; // ms
  while (attempts < maxAttempts) {
    attempts++;
    var resp, code, txt;
    try {
      resp = UrlFetchApp.fetch(url, opts);
      code = resp.getResponseCode();
      txt = resp.getContentText();
      if (code >= 200 && code < 300) {
        return txt ? JSON.parse(txt) : [];
      }
      if (verbose) Logger.log('HTTP %s on attempt %s: %s', code, attempts, txt && txt.slice ? txt.slice(0, 300) : '');
    } catch (e) {
      if (verbose) Logger.log('Fetch error on attempt %s: %s', attempts, e && e.message ? e.message : e);
    }
    Utilities.sleep(wait);
    wait *= 2;
  }
  throw new Error('Failed to fetch after ' + maxAttempts + ' attempts: ' + url);
}

function buildUrl_(base, params) {
  var parts = [];
  for (var k in params) {
    if (!params.hasOwnProperty(k)) continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  }
  return base + (parts.length ? ('?' + parts.join('&')) : '');
}
