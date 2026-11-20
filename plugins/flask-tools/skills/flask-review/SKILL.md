---
name: flask-review
description: Review a change in a Flask app (and any PowerShell scripts in the repo) for bugs and security issues before it is committed or pushed, quoting the exact line for every finding. Works on the main branch too (uncommitted changes or the last commits). Use when the user asks to review, check or look over their Flask code or a PowerShell script, or says "nézd át", "ellenőrizd a kódot", "review", "mielőtt commitolom".
---

# Flask review

Review one change in a Flask app. Report only problems you can point to in the code; fix the obvious ones, ask about the rest. Never commit, push or open a PR. Answer in the user's language.

## 1. Pick what to review

Use the first that is non-empty, and say which one you picked:

1. Anything the user named (files, a commit, a range).
2. Uncommitted work: `git diff HEAD` plus untracked files from `git status --porcelain`.
3. A feature branch: `git diff $(git merge-base origin/main HEAD)` (or `master`).
4. On the main branch with a clean tree: the last commit, `git show HEAD`. Offer a wider range ("the last 5 commits?") instead of stopping.

Read the whole diff first, then open the surrounding code of each changed function: a bug is often in what the diff calls, not in the diff itself.

Learn the app before judging it: how it starts (`create_app()` or a module-level `app`), the database layer (SQLAlchemy, Flask-SQLAlchemy or raw `sqlite3`), auth (Flask-Login or a hand-made session check), forms (Flask-WTF or raw `request.form`), migrations (Flask-Migrate/Alembic or none). Only apply the checks below that fit what the app uses.

## 2. What to look for

**Critical** (data loss, security hole, wrong numbers):

- **SQL built from strings**: f-strings, `%` or `+` in `execute(...)`, `text(...)` or `.filter(text(...))`. Fix: parameters (`execute("... WHERE id = ?", (id,))`, `text("... :id")`).
- **Missing login check**: a new or changed route that reads or writes data without `@login_required` (or the app's own check), or one that loads a record by id without checking it belongs to the current user.
- **CSRF**: a POST form without a CSRF token. With Flask-WTF: `{{ form.hidden_tag() }}` or `{{ csrf_token() }}` in the template and `CSRFProtect(app)`. Without it: say the app has no CSRF protection at all, once.
- **State change on GET**: a route that deletes or edits on GET (links, `?delete=1`).
- **XSS**: `|safe`, `Markup(...)`, `render_template_string` with user data, or `autoescape false`.
- **Secrets and config**: a hard-coded `SECRET_KEY`, passwords, API keys, tokens or connection strings in code; `debug=True` or `FLASK_DEBUG=1` that would reach a non-local run; `app.run(host="0.0.0.0")` without a reason.
- **Uploads and paths**: user-supplied file names without `secure_filename`, or `send_file`/`open` built from user input (path traversal).
- **Money and stock maths**: `float` for money or quantities that must add up (use `Decimal` or integer units), rounding in the wrong place, a stock change that is not in the same transaction as the record it belongs to, a read-modify-write on a quantity without a lock or an atomic `UPDATE ... SET qty = qty - ?`.
- **Transactions**: `commit()` missing after a write, or a write split over several commits so a failure leaves half a change; a broad `except:` that swallows a failed commit without `rollback()`.
- **Migrations**: a model change with no migration, a migration that drops or renames a column holding data, or a `downgrade()` that cannot undo its `upgrade()`.
- **Shell and code execution** (Python): `subprocess` with `shell=True` and user data, `os.system`, `eval`/`exec`, `pickle.loads` on untrusted input.

**Informational** (worth fixing, not dangerous):

- N+1 queries in a list page (a query inside a loop; SQLAlchemy: `joinedload`/`selectinload`).
- A new value (status, category, unit) not handled in every `if/elif` or template branch that lists the others: search the code for the sibling values.
- Error paths: what the user sees on a missing record (`get_or_404`), an invalid form, a failed commit.
- Dead code, a duplicated helper, names that no longer say what the code does.

**PowerShell scripts** (`*.ps1`, `*.psm1`) in the change:

- `Invoke-Expression` / `iex` on built strings or downloaded content.
- Passwords, client secrets, tenant ids or tokens in the script instead of `Get-Credential`, a secret store or an environment variable.
- `-ExecutionPolicy Bypass` baked into a scheduled task or shortcut.
- Destructive commands (`Remove-Item -Recurse`, `Remove-PnPListItem`, bulk `Set-*`) without `-WhatIf` support or a confirmation.
- Missing `$ErrorActionPreference = 'Stop'` (or `-ErrorAction Stop`) where a failed step must stop the script.
- Local paths with a user name (`C:\Users\<name>\...`) that will break on another machine or leak who wrote it.

## 3. The bar for a finding

For every finding:

- Quote the line (`path:line` and the code). No quote, no finding.
- Give a confidence from 1 to 10. 9-10: you traced the input to the problem. 7-8: very likely, one assumption left. 5-6: plausible, say what would confirm it. Below 5: leave it out.
- Say in one line what goes wrong for a real user, and in one line what fixes it.

Do not report style preferences, things the diff already fixes, or problems in code the change does not touch (mention those once at the end, under "Not in this change", if they are critical).

## 4. Fix first, then ask

- **Fix directly** what is mechanical and has one right answer: a parameterised query, a missing `commit()`/`rollback()`, `get` to `get_or_404`, a missing `secure_filename`, a hard-coded path that has an obvious config value. Show each fix as a short diff.
- **Ask** (one batched question, not one per item) before anything that changes behaviour or needs a decision: adding auth to a route, money types, transactions, migrations, deleting code, new dependencies (Flask-WTF, Flask-Limiter).
- **Never** run a migration against the real database, change `.env` files, rotate or print secrets, or commit.

After fixing, run the app's own checks if they exist (`pytest`, `python -m pytest`, `flake8`/`ruff`), and say plainly whether they passed, failed, or there were none.

## 5. Report

```
Review: <what was reviewed: uncommitted / branch / last commit abc123>

Critical
- [9/10] app/routes.py:42  db.execute(f"SELECT * FROM items WHERE sku = '{sku}'")
  SQL injection: a crafted SKU reads or deletes any table.  Fixed: parameter (?).

Informational
- [7/10] templates/stock.html:18  N+1: one query per row ...

Asked / waiting on you
- ...

Checks: pytest 14 passed / no tests found
Not in this change: ...
```

If nothing survives the bar, say so in one line, and say what you checked.
