---
name: flask-qa
description: Test a Flask app end to end without touching its real data - every route and every form (valid, empty and wrong input) against a throwaway copy of the database, then a report with steps to reproduce each bug. Optionally writes pytest regression tests. Never commits. Use when the user asks to test, QA or try out their Flask app, or says "teszteld", "próbáld ki az appot", "nézd meg, működik-e", "keress hibát az appban".
---

# Flask QA

Exercise a Flask app the way a user would, find what breaks, and report it with steps to reproduce. Answer in the user's language.

Three rules hold for the whole run:

- **The real database is never touched.** Everything runs against a copy in a temporary folder. If you cannot make that guarantee, stop and ask.
- **Nothing is committed.** Fixes and tests are proposed as diffs; the user reviews and commits.
- **No real credentials.** Create a test user in the copy; never ask for or type the user's own password.

## 1. Learn the app

Read, do not run yet:

- **Python**: the project's virtualenv if there is one (`.venv\Scripts\python.exe` or `venv\Scripts\python.exe` on Windows, `.venv/bin/python` elsewhere), else `python` / `py -3`. Check that `import flask` works with it.
- **Entry point**: an app factory (`create_app(...)`) or a module-level `app = Flask(...)`; what `FLASK_APP` / `.flaskenv` point at.
- **Database**: SQLAlchemy (`SQLALCHEMY_DATABASE_URI`), raw `sqlite3.connect(...)`, or something else. Find the real file (often `instance/*.db` or a path in config/`.env`).
- **How the database path is chosen**: a config key, an environment variable, a factory argument, or a hard-coded path.
- **Auth** (Flask-Login, a session check, none), **CSRF** (Flask-WTF / `CSRFProtect`, none), **migrations** (Flask-Migrate or `db.create_all()`).

## 2. Isolate the data

1. Make a temporary folder outside the repo (`$env:TEMP` on Windows, `/tmp` elsewhere), e.g. `flask-qa-<timestamp>`. All scripts and files of this run go there, not into the repo.
2. Note the real database's size and SHA-256 now (`Get-FileHash` / `sha256sum`), to prove at the end that it did not change.
3. Copy the database file into the temporary folder. If there is no database yet, plan to create a fresh one there with the app's own `db.create_all()` or migrations.
4. Point the app at the copy, in this order of preference:
   - a config override: `create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///<copy>", "TESTING": True})`, or setting `app.config[...]` before the first request;
   - the environment variable the app reads (`DATABASE_URL`, `SQLALCHEMY_DATABASE_URI`, ...);
   - for a relative, hard-coded path: run from a full copy of the project in the temporary folder (without `.git`, `.venv`, `node_modules`).
5. **Stop and ask** if the path is absolute and hard-coded, if the app talks to a server database (PostgreSQL, MySQL, MSSQL, SharePoint, an API), or if anything else in the app writes to the outside world (e-mail, file shares, external APIs) and you cannot switch it off for the test.

## 3. Exercise every route (no server needed)

Write one Python script in the temporary folder that imports the app, applies the override above, and uses Flask's test client (`app.test_client()`). Use only the standard library besides the app's own dependencies (`html.parser` for forms).

1. **Log in**: create a test user in the copy through the app's own model or registration route, then log in through the real login form. For apps with roles, create one user per role if it is cheap.
2. **Routes**: list `app.url_map`. Request every GET route; fill URL parameters (`<int:id>`, `<sku>`) with real ids from the copy, plus one id that does not exist.
3. **Forms**: parse each page's `<form>` elements (action, method, fields, `required`, `type`, `min`/`max`, `<select>` options). Submit each one three ways:
   - **valid**: sensible values taken from existing records and field types;
   - **empty**: every field blank;
   - **wrong**: text in number fields, negative and huge quantities and prices (`-1`, `0`, `999999999`), `0.1 + 0.2`-style decimals, a 5000-character string, `' " < > ;` and accented characters (`árvíztűrő tükörfúrógép`), a duplicate of a unique value (SKU, code, name), an id belonging to another user.
   With Flask-WTF, read the CSRF token from the form like a browser does; do not switch CSRF off unless the token cannot be obtained, and say so if you did.
4. **For every response, check**: status 500 or a traceback in the body or log; a 200 or redirect that accepted invalid data (look in the copy: was the row saved?); a missing flash/error message; a page that renders `None`, `nan` or a raw exception; logged-out access to a page that should need login; another user's record visible or editable.
5. **Inventory and warehouse logic**, if the app has it: stock going negative, a movement that changes stock without a record (or the reverse), totals that do not add up after several movements (compare with a recount from the movement table), deleting an item that still has stock or movements, the same SKU twice, unit or rounding errors in prices and values.

Keep the script under the temporary folder and re-run it after a fix to show the bug is gone.

## 4. Browser pass (optional)

Only if a browser tool is available (for example a Playwright MCP or the browser built into Claude) and the app has JavaScript or layout worth checking. Ask before starting it.

- Start the app on a free port against the copy, in the background: PowerShell `Start-Process -NoNewWindow <python> -ArgumentList '-m','flask','run','--port','5001'` with the override in the environment; bash `<python> -m flask run --port 5001 &`. Wait until `http://127.0.0.1:5001` answers.
- Click through the main flows, watch the browser console for errors, take a screenshot of each broken page.
- Stop the server afterwards.

## 5. Report

```
Flask QA: <app>  ·  database: copy of instance/app.db (real file unchanged: SHA-256 matches)
Routes: 23 tested · Forms: 9 × 3 submissions · Users: admin, user

Bugs
1. [critical] POST /stock/out accepts a quantity larger than the stock; stock becomes -4.
   Repro: log in as user, item SKU A-100 (stock 6), "Kiadás" form, quantity 10 → saved, no error.
   Where: app/stock.py:88 (no check before the UPDATE).
2. [major] GET /items/9999 → 500 (AttributeError) instead of 404. app/items.py:31
...

Looked fine: login/logout, item list, CSV export, ...
Not tested: <what and why, e.g. e-mail sending switched off, no browser tool>
```

Severity: **critical** = wrong data saved, data of another user, security; **major** = 500 error, a broken flow; **minor** = message, layout, wording.

## 6. Fixes and regression tests (ask first)

After the report, offer, per bug or as a batch:

- a **minimal fix** as a diff;
- a **pytest** regression test in the repo's `tests/` folder (create it if missing), named `test_<area>.py`, that fails before the fix and passes after: an app fixture that points the database at `tmp_path`, the test client, and the exact request from the repro. Never point a test at the real database file.

Apply only what the user approves, run `pytest` and show the result. Do not commit.

## 7. Clean up

Stop any server you started, delete the temporary folder, check the real database's SHA-256 again and state in the report that it is unchanged (or, if it changed, say so first and loudly).
