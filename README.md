# GST Registration & Amendment Tracker — installable web app (PWA) for GitHub Pages

A static web app (no server, no database of its own). Your data lives in a **brand-new Google Sheet that this app creates in your own Google Drive**.
It is completely separate from any earlier Apps Script tracker or Sheet: different Google Cloud project, different spreadsheet, no shared URL or token.

## What it does
- Add / edit ARNs (one row per ARN, amendments included). Validates ARN (15 letters/digits, unique) and GSTIN (format + check digit).
- State is filled automatically: valid GSTIN first, else the state code in the ARN (3rd-4th characters).
- **Track** button opens the GST portal Track Status page with the ARN (`#gsttracker-arn=...`). The **Chrome extension** (separate folder) selects Registration and fills the ARN. **You** solve the CAPTCHA and click SEARCH. Nothing here automates the portal.
- After the search, the extension banner shows **Copy extracted data**. In this app click **Import portal result** and paste. Portal-derived columns are updated; your entries are never overwritten; GSTIN/State are filled only when blank.
- Dashboard (pending / approved / rejected / overdue / not yet tracked), search, filters, Audit Log and Case History sheets inside the Google Sheet.
- Sheet columns are exactly your template (A:S), plus T GSTIN, U Tracking Status, V Last Checked At, W Tracking Note.

## Security design
- **Scope `drive.file` only**: the app can see and edit only files it created itself. It cannot open your other Sheets or Drive files — including your old tracker.
- No backend, analytics or third-party servers. The browser talks only to Google (`accounts.google.com`, `sheets.googleapis.com`), enforced by a Content-Security-Policy.
- The Google access token is kept in memory only (gone when you close the tab; expires in ~1 hour). No client secret, no refresh token. Sheet data is not cached by the service worker or stored in the browser; the browser keeps only your OAuth Client ID and the new sheet's ID.
- All sheet text is escaped when displayed and neutralised against spreadsheet-formula injection when written.
- The Google Sheet is stored in your Google Drive; share it only with people you trust.
- If you later change the OAuth Client ID, the app can no longer open the sheet created by the old one (Drive `drive.file` rule). Keep the same Client ID.

## 1. Put it on GitHub Pages
1. Create a GitHub repository (it can be **private** if your plan supports Pages for private repos, otherwise public — the app contains no secrets).
2. Upload the contents of this folder (index.html, app.js, core.js, logic.js, config.js, styles.css, sw.js, manifest.webmanifest, icons/) to the repo root. Do not upload `tests/` unless you want it.
3. Repo **Settings > Pages > Build and deployment > Deploy from a branch > main / (root) > Save**.
4. After a minute the app is at `https://<your-username>.github.io/<repo>/`. Note the origin: `https://<your-username>.github.io` (no path).

## 2. Create the Google OAuth Client ID (about 5 minutes, free)
1. Go to <https://console.cloud.google.com/>, create a **new project** (e.g. "GST Tracker App").
2. **APIs & Services > Library** > enable **Google Sheets API**.
3. **OAuth consent screen** (Google Auth Platform): User type **External**; app name; your email. Add the scope `.../auth/drive.file`.
   Keep it in **Testing** and add your own Google account under **Test users**, *or* click **Publish app** (this scope is non-sensitive, so no verification is needed).
4. **Credentials > Create credentials > OAuth client ID > Web application.**
   **Authorised JavaScript origins:** `https://<your-username>.github.io`. (No redirect URI is needed.)
5. Copy the **Client ID** (`....apps.googleusercontent.com`). Never create or use a client secret for this app.

## 3. First run
1. Open your GitHub Pages URL. **Settings** > paste the Client ID > Save. (Or put it in `config.js` before uploading — it is public by design.)
2. **Connect Google** > choose your account > allow "See, edit, create and delete only the specific Google Drive files you use with this app".
3. **Create new tracker sheet**. A new spreadsheet "GST Registration & Amendment Tracker" appears in your Drive; **Open Google Sheet** opens it.
4. Install it: Chrome/Edge address-bar install icon or menu > *Install app* (on iPhone: Share > Add to Home Screen).

## 4. Daily use with the extension
1. **+ Add ARN**, then **Track** on the row. The GST portal opens with Registration selected and the ARN filled (extension from the `extension/` folder is loaded in Chrome).
2. Solve the CAPTCHA, click **SEARCH**. The banner shows "Copy extracted data".
3. In this app: **Import portal result** > paste > Import. The row, Case History and Audit Log are updated.
The extension's Apps Script options can stay empty; without them it offers the copy button. Use **Refresh** if you edit the Sheet directly.

## Limits
- You must reconnect after about an hour (the token is not stored). A browser pop-up asks you to confirm; no password is stored.
- Edits made directly in Google Sheets are not audited by the app and do not auto-fill State; use the app for audited changes (sheet-level validation, dropdowns and colours are still set).
- Edit one place at a time: if two people change the same row simultaneously, the last save wins (the app re-reads before saving and refuses if the row moved).
- Offline: the app shell opens offline, but data needs a connection.
- Portal extraction is unchanged from the extension (label-driven; fix labels in `extension/extract.js` if the portal changes).

## Tests (optional, Node 18+)
`cd tests && npm install && npm test` — 24 pure-logic checks (state rules, import rules, dashboard, formula-injection guard, `core.js` identical to the audited Apps Script `Core.gs`) and 24 app checks (renders the real page in jsdom against a fake Sheets API: create sheet, add, duplicate rejection, import, re-import, XSS escaping, filters).
