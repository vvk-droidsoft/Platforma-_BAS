# -*- coding: utf-8 -*-
"""Smoke-проверка ЛИС после деплоя.

Примеры:
  python smoke_check.py --base http://127.0.0.1:8080
  python smoke_check.py --base http://45.38.3.49:8080 --login admin --password admin

Код выхода: 0 = всё ок, 1 = есть провалы.
Пароль: --password / $env:ADMIN_PASSWORD / $env:LIS_SMOKE_PASSWORD (по умолчанию admin).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

SESSION_COOKIE = "lis_session"


class Client:
    def __init__(self, base: str, timeout: float = 15.0):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.token = ""
        self.cookie = ""

    def request(
        self,
        method: str,
        path: str,
        *,
        data: Optional[dict] = None,
        auth: bool = False,
        allow_redirects: bool = False,
    ) -> Tuple[int, Dict[str, str], bytes]:
        url = path if path.startswith("http") else self.base + path
        headers = {"Accept": "application/json, text/html;q=0.9,*/*;q=0.8"}
        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            if self.token:
                headers["Authorization"] = "Bearer " + self.token
            if self.cookie:
                headers["Cookie"] = self.cookie
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            # не следовать редиректам автоматически — проверяем 303 сами
            opener = urllib.request.build_opener(urllib.request.HTTPHandler())
            if not allow_redirects:
                class NoRedirect(urllib.request.HTTPRedirectHandler):
                    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N803
                        return None

                opener = urllib.request.build_opener(NoRedirect)
            with opener.open(req, timeout=self.timeout) as resp:
                raw = resp.read()
                hdrs = {k.lower(): v for k, v in resp.headers.items()}
                return resp.getcode() or 0, hdrs, raw
        except urllib.error.HTTPError as e:
            raw = e.read() if e.fp else b""
            hdrs = {k.lower(): v for k, v in (e.headers.items() if e.headers else [])}
            return e.code or 0, hdrs, raw
        except Exception as e:  # noqa: BLE001 — smoke: любая сеть = fail
            raise RuntimeError(f"{method} {path}: {e}") from e


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def run(base: str, login: str, password: str) -> int:
    c = Client(base)
    fails: List[str] = []
    oks: List[str] = []

    def ok(msg: str) -> None:
        oks.append(msg)
        print("  OK  " + msg)

    def fail(msg: str) -> None:
        fails.append(msg)
        print("  FAIL " + msg)

    print(f"==> Smoke {base}")

    # 1) аноним: кабинет → логин
    try:
        code, hdrs, _ = c.request("GET", "/admin")
        loc = hdrs.get("location", "")
        if code in (302, 303) and "/login" in loc:
            ok(f"/admin → {code} login")
        else:
            fail(f"/admin anonymous got {code} location={loc!r} (expected 303 /login)")
    except RuntimeError as e:
        fail(str(e))

    # 2) страница логина
    try:
        code, _, raw = c.request("GET", "/login")
        if code == 200 and b"<html" in raw.lower():
            ok("/login 200")
        else:
            fail(f"/login got {code}")
    except RuntimeError as e:
        fail(str(e))

    # 3) публичная шкала
    try:
        code, _, raw = c.request("GET", "/api/grading")
        data = _json(raw)
        if code == 200 and isinstance(data, dict) and data.get("ok"):
            ok("/api/grading")
        else:
            fail(f"/api/grading got {code} {raw[:120]!r}")
    except RuntimeError as e:
        fail(str(e))

    # 4) логин
    try:
        code, hdrs, raw = c.request(
            "POST", "/api/admin/login", data={"login": login, "password": password}
        )
        data = _json(raw) or {}
        token = (data.get("token") or "").strip()
        set_cookie = hdrs.get("set-cookie") or ""
        if code == 200 and token:
            c.token = token
            # вытащить lis_session=...
            m = re.search(rf"{SESSION_COOKIE}=([^;]+)", set_cookie)
            if m:
                c.cookie = f"{SESSION_COOKIE}={m.group(1)}"
            else:
                c.cookie = f"{SESSION_COOKIE}={token}"
            user = data.get("user") or {}
            ok(f"login as {user.get('login') or login} role={user.get('role')}")
        else:
            fail(f"login failed {code}: {raw[:200]!r}")
            print(f"==> Result: {len(oks)} ok, {len(fails)} fail (stopped before auth checks)")
            return 1
    except RuntimeError as e:
        fail(str(e))
        print(f"==> Result: {len(oks)} ok, {len(fails)} fail")
        return 1

    # 5) /api/admin/me + modules
    try:
        code, _, raw = c.request("GET", "/api/admin/me", auth=True)
        data = _json(raw) or {}
        user = data.get("user") or {}
        modules = user.get("modules")
        if code == 200 and data.get("ok") and isinstance(modules, dict):
            ok(f"/api/admin/me modules={len(modules)}")
            if "is_tester" not in user and "can_flight_sheet" not in user:
                fail("/api/admin/me: нет is_tester/can_flight_sheet")
            else:
                ok(f"is_tester={bool(user.get('is_tester'))}")
        else:
            fail(f"/api/admin/me got {code} {raw[:160]!r}")
    except RuntimeError as e:
        fail(str(e))

    # 6) HTML кабинета с авто-?v=
    try:
        code, _, raw = c.request("GET", "/admin", auth=True, allow_redirects=True)
        text = raw.decode("utf-8", errors="replace")
        if code != 200:
            fail(f"/admin authed got {code}")
        elif "admin-app.js?v=" not in text:
            fail("/admin: нет admin-app.js?v= (static_version)")
        else:
            m = re.search(r"admin-app\.js\?v=([a-f0-9]+)", text)
            ok(f"/admin HTML + static bust ({m.group(1) if m else '?'})")
        if "lis-nav.js" not in text and "lis-nav.js?v=" not in text:
            # _with_nav добавляет lis-nav; bust может добавить ?v=
            if "lis-nav" not in text:
                fail("/admin: нет lis-nav")
            else:
                ok("lis-nav present")
        else:
            ok("lis-nav wired")
    except RuntimeError as e:
        fail(str(e))

    # 7) hub + generator tool
    try:
        code, _, raw = c.request("GET", "/", auth=True, allow_redirects=True)
        if code == 200 and b"<html" in raw.lower():
            ok(f"/ hub {code}")
        else:
            fail(f"/ got {code}")
    except RuntimeError as e:
        fail(str(e))

    try:
        code, _, raw = c.request("GET", "/tools/generator", auth=True, allow_redirects=True)
        text = raw.decode("utf-8", errors="replace")
        if code == 200 and "generator-app.js" in text:
            if "generator-app.js?v=" in text or "generator.css?v=" in text:
                ok("/tools/generator + bust")
            else:
                ok("/tools/generator 200 (bust soft)")
        else:
            fail(f"/tools/generator got {code}")
    except RuntimeError as e:
        fail(str(e))

    # 8) список тестов (боевой кабинет)
    try:
        code, _, raw = c.request("GET", "/api/tests", auth=True)
        if code == 200:
            ok("/api/tests")
        else:
            fail(f"/api/tests got {code} {raw[:120]!r}")
    except RuntimeError as e:
        fail(str(e))

    # 8b) штатная расстановка /org (smoke логинится как admin)
    try:
        code, _, raw = c.request("GET", "/org", auth=True, allow_redirects=True)
        text = raw.decode("utf-8", errors="replace")
        if code == 200 and "Штатная расстановка" in text:
            ok("/org page")
        else:
            fail(f"/org got {code}")
    except RuntimeError as e:
        fail(str(e))

    # 9) preview API без тестера → 403 (если текущий юзер не tester)
    try:
        code, _, raw = c.request("GET", "/api/admin/me", auth=True)
        user = ((_json(raw) or {}).get("user") or {})
        is_tester = bool(user.get("is_tester") or user.get("can_flight_sheet"))
        wcode, _, wraw = c.request("GET", "/api/workload?year=2026&month=1", auth=True)
        if is_tester:
            if wcode == 200:
                ok("workload allowed for tester")
            else:
                fail(f"tester workload got {wcode} {wraw[:120]!r}")
        else:
            if wcode == 403:
                ok("workload blocked for non-tester (preview)")
            elif wcode == 200:
                fail("workload 200 for non-tester — preview gate broken?")
            else:
                fail(f"workload unexpected {wcode} for non-tester")
    except RuntimeError as e:
        fail(str(e))

    print(f"==> Result: {len(oks)} ok, {len(fails)} fail")
    if fails:
        print("Failed checks:")
        for f in fails:
            print("  - " + f)
        return 1
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="LIS smoke check")
    p.add_argument(
        "--base",
        default=os.environ.get("LIS_SMOKE_BASE", "http://127.0.0.1:8080"),
        help="Base URL (default LIS_SMOKE_BASE or http://127.0.0.1:8080)",
    )
    p.add_argument("--login", default=os.environ.get("LIS_SMOKE_LOGIN", "admin"))
    p.add_argument(
        "--password",
        default=os.environ.get("LIS_SMOKE_PASSWORD")
        or os.environ.get("ADMIN_PASSWORD")
        or "admin",
    )
    args = p.parse_args()
    try:
        return run(args.base, args.login, args.password)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
