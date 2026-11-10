# -*- coding: utf-8 -*-
"""Ведомость результатов тестирования: матрица курсант × тесты + Excel."""
from __future__ import annotations

import io
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from . import db
from . import distributions
from . import board_writeoff

_MONTHS_RU = (
    "",
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\u00a0", " ")).strip()


def _norm_key(s: str) -> str:
    return _norm(s).casefold().replace("ё", "е")


def format_ru_date(value: str) -> str:
    raw = _norm(value)
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            dt = datetime.strptime(raw[:10] if fmt.startswith("%Y") else raw, fmt)
            return f"{dt.day} {_MONTHS_RU[dt.month]} {dt.year}"
        except ValueError:
            continue
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw)
    if m:
        try:
            dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return f"{dt.day} {_MONTHS_RU[dt.month]} {dt.year}"
        except ValueError:
            pass
    return raw


def period_label(period_from: str, period_to: str) -> str:
    a = format_ru_date(period_from)
    b = format_ru_date(period_to)
    if a and b:
        return f"Период с {a} по {b}"
    if a:
        return f"Период с {a}"
    if b:
        return f"Период по {b}"
    return "Период не задан"


def _grade_num(value: Any) -> Optional[float]:
    if value is None:
        return None
    s = str(value).strip().replace(",", ".")
    if not s:
        return None
    try:
        g = float(s)
    except ValueError:
        return None
    if g < 1 or g > 5:
        return None
    return g


def _best_grades(
    attempts: Sequence[Dict[str, Any]], test_ids: Sequence[str]
) -> Dict[Tuple[str, str], float]:
    """(student_num, test_id) → лучшая оценка."""
    want = set(test_ids)
    best: Dict[Tuple[str, str], float] = {}
    for a in attempts:
        tid = (a.get("test_id") or "").strip()
        if tid not in want:
            continue
        num = _norm(str(a.get("student_num") or ""))
        if not num:
            continue
        g = _grade_num(a.get("grade"))
        if g is None:
            continue
        key = (num, tid)
        prev = best.get(key)
        if prev is None or g > prev:
            best[key] = g
    return best


def _catalog_modules() -> List[Dict[str, Any]]:
    rows = list(db.list_published_catalog() or [])
    rows.sort(key=lambda t: (t.get("created_at") or "", t.get("title") or ""))
    return [t for t in rows if t.get("id")]


def _catalog_module_index() -> Dict[str, int]:
    """id канона → № модуля (1-based), по возрастанию created_at."""
    return {str(t.get("id") or ""): i for i, t in enumerate(_catalog_modules(), 1)}


def _test_column_label(test: Dict[str, Any], module_idx: Dict[str, int]) -> str:
    tid = str(test.get("id") or "")
    src = (test.get("source_module_id") or "").strip()
    pub = bool(test.get("published_for_all"))
    canon = src or (tid if pub and not src else "")
    if canon and canon in module_idx:
        return f"Модуль №{module_idx[canon]}"
    if pub and tid in module_idx:
        return f"Модуль №{module_idx[tid]}"
    title = _norm(test.get("title") or "Тест")
    # укоротить длинные названия
    if len(title) > 28:
        title = title[:27] + "…"
    return title


def _header_line(stream_num: str, group_num: str) -> str:
    return f"Поток {stream_num}  Группа {group_num}"


def _attempt_canon_module(
    attempt: Dict[str, Any],
    test_by_id: Dict[str, Dict[str, Any]],
    catalog_ids: Set[str],
) -> Optional[str]:
    """Канон обязательного модуля для попытки (сам канон или копия)."""
    tid = str(attempt.get("test_id") or "").strip()
    if not tid:
        return None
    t = test_by_id.get(tid) or {}
    src = (t.get("source_module_id") or "").strip()
    if src and src in catalog_ids:
        return src
    if tid in catalog_ids:
        return tid
    if bool(t.get("published_for_all")) and not src:
        return tid
    return None


def _best_module_grades(
    attempts: Sequence[Dict[str, Any]],
    user: Optional[dict] = None,
) -> Dict[Tuple[str, str], float]:
    """(student_num, canon_module_id) → лучшая оценка по обязательным модулям."""
    catalog = _catalog_modules()
    catalog_ids = {str(t.get("id") or "") for t in catalog if t.get("id")}
    if not catalog_ids:
        return {}
    tests = {str(t.get("id") or ""): t for t in (auth_visible_tests(user) or []) if t.get("id")}
    # копии модулей могут быть не в visible — подтянуть все тесты для маппинга
    for t in db.list_tests(include_module_copies=True) or []:
        tid = str(t.get("id") or "")
        if tid and tid not in tests:
            tests[tid] = t
    best: Dict[Tuple[str, str], float] = {}
    for a in attempts:
        canon = _attempt_canon_module(a, tests, catalog_ids)
        if not canon:
            continue
        num = _norm(str(a.get("student_num") or ""))
        if not num:
            continue
        g = _grade_num(a.get("grade"))
        if g is None:
            continue
        key = (num, canon)
        prev = best.get(key)
        if prev is None or g > prev:
            best[key] = g
    return best


def _short_fio(fio: str) -> str:
    return board_writeoff.short_fio(fio)


def _visible_attempts(user: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Те же попытки, что видит аккордеон «Результаты» для учётки."""
    from . import auth

    attempts = list(db.list_attempts() or [])
    vids = auth.visible_test_ids(user) if user else None
    if vids is not None:
        idset = set(vids)
        attempts = [a for a in attempts if a.get("test_id") in idset]
    return attempts


def _cadets_directory_map() -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    with db.connect() as conn:
        for r in conn.execute(
            """
            SELECT student_num, callsign, full_name, group_num, stream_num
            FROM cadets
            WHERE TRIM(COALESCE(student_num,''))<>''
            """
        ).fetchall():
            d = dict(r)
            num = _norm(str(d.get("student_num") or ""))
            if not num:
                continue
            out[num] = {
                "num": num,
                "callsign": _norm(d.get("callsign") or ""),
                "fio": _norm(d.get("full_name") or ""),
                "stream_num": _norm(str(d.get("stream_num") or "")),
                "group_num": _norm(str(d.get("group_num") or "")),
            }
    return out


def _dist_meta_by_group() -> Dict[Tuple[str, str], Dict[str, Any]]:
    """Поток+группа → период/staff из распределения (для шапки ведомости)."""
    out: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for dbrief in distributions.list_distributions() or []:
        did = dbrief.get("id")
        if not did:
            continue
        dist = distributions.get_distribution(did)
        if not dist:
            continue
        for s in dist.get("streams") or []:
            stream_num = _norm(str(s.get("stream_num") or ""))
            s_from = s.get("period_from") or ""
            s_to = s.get("period_to") or ""
            for g in s.get("groups") or []:
                group_num = _norm(str(g.get("group_num") or ""))
                if not stream_num or not group_num:
                    continue
                key = (stream_num, group_num)
                if key in out:
                    continue
                instructors = g.get("instructors") or []
                assistants = g.get("assistants") or []
                staff = []
                for p in instructors:
                    staff.append(
                        {
                            "role": "instructor",
                            "role_label": "Инструктор",
                            "fio": p.get("fio") or "",
                            "short": _short_fio(p.get("fio") or ""),
                            "id": (p.get("id") or "").strip(),
                        }
                    )
                for p in assistants:
                    staff.append(
                        {
                            "role": "assistant",
                            "role_label": "Ассистент инструктора",
                            "fio": p.get("fio") or "",
                            "short": _short_fio(p.get("fio") or ""),
                            "id": (p.get("id") or "").strip(),
                        }
                    )
                out[key] = {
                    "id": g.get("id") or "",
                    "distribution_id": did,
                    "stream_num": stream_num,
                    "group_num": group_num,
                    "period_from": (g.get("period_from") or s_from) or "",
                    "period_to": (g.get("period_to") or s_to) or "",
                    "staff": staff,
                }
    return out


def _results_groups(user: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Группы/курсанты как в таблице «Результаты»: из видимых попыток.

    Поток/группа/позывной берутся так же, как в list_attempts (roster → cadets).
    Период и инструкторский блок — из распределения, если есть совпадение.
    """
    attempts = _visible_attempts(user)
    cadet_dir = _cadets_directory_map()
    dist_meta = _dist_meta_by_group()

    buckets: Dict[Tuple[str, str], Dict[str, Dict[str, Any]]] = {}
    for a in attempts:
        num = _norm(str(a.get("student_num") or ""))
        if not num:
            continue
        cdir = cadet_dir.get(num) or {}
        sn = _norm(str(a.get("stream_num") or cdir.get("stream_num") or ""))
        gn = _norm(str(a.get("group_num") or cdir.get("group_num") or ""))
        if not sn or not gn:
            continue
        key = (sn, gn)
        cadets = buckets.setdefault(key, {})
        if num in cadets:
            # дополнить пустые поля более полными значениями
            cur = cadets[num]
            call = _norm(a.get("callsign") or "") or cur.get("callsign") or ""
            fio = _norm(a.get("full_name") or "") or cur.get("fio") or ""
            if not call:
                call = cdir.get("callsign") or ""
            if not fio:
                fio = cdir.get("fio") or ""
            cur["callsign"] = call
            cur["fio"] = fio
            continue
        call = _norm(a.get("callsign") or "") or cdir.get("callsign") or ""
        fio = _norm(a.get("full_name") or "") or cdir.get("fio") or ""
        cadets[num] = {"num": num, "callsign": call, "fio": fio}

    out: List[Dict[str, Any]] = []
    for (sn, gn), cadets in sorted(buckets.items(), key=lambda x: (x[0][0], x[0][1])):
        meta = dist_meta.get((sn, gn)) or {}
        rows = list(cadets.values())
        rows.sort(
            key=lambda c: (
                int(c["num"]) if c["num"].isdigit() else 10**9,
                c["num"],
            )
        )
        out.append(
            {
                "id": meta.get("id") or "",
                "distribution_id": meta.get("distribution_id") or "",
                "stream_num": sn,
                "group_num": gn,
                "period_from": meta.get("period_from") or "",
                "period_to": meta.get("period_to") or "",
                "cadets": rows,
                "staff": meta.get("staff") or [],
            }
        )
    return out


def commission_list(user: Optional[dict] = None) -> Dict[str, Any]:
    """Курсанты с ≥2 двойками по обязательным модулям (из выборки «Результаты»)."""
    groups = _results_groups(user)
    module_idx = _catalog_module_index()
    catalog = _catalog_modules()
    if not catalog:
        return {"count": 0, "modules_count": 0, "rows": []}

    best = _best_module_grades(db.list_attempts() or [], user)

    seen_nums: Set[str] = set()
    rows_out: List[Dict[str, Any]] = []
    for g in groups:
        for c in g.get("cadets") or []:
            num = c.get("num") or ""
            if not num or num in seen_nums:
                continue
            fails = []
            for mod in catalog:
                mid = str(mod.get("id") or "")
                grade = best.get((num, mid))
                if grade is None:
                    continue
                if float(grade) == 2.0:
                    label = (
                        f"Модуль №{module_idx[mid]}"
                        if mid in module_idx
                        else _norm(mod.get("title") or mid)
                    )
                    fails.append(
                        {
                            "module_id": mid,
                            "label": label,
                            "title": mod.get("title") or "",
                            "grade": 2,
                        }
                    )
            if len(fails) < 2:
                continue
            seen_nums.add(num)
            rows_out.append(
                {
                    "num": num,
                    "callsign": c.get("callsign") or "—",
                    "fio": c.get("fio") or "",
                    "stream_num": g.get("stream_num") or "",
                    "group_num": g.get("group_num") or "",
                    "fails": fails,
                    "fail_count": len(fails),
                }
            )

    rows_out.sort(
        key=lambda r: (
            r.get("stream_num") or "",
            r.get("group_num") or "",
            int(r["num"]) if str(r["num"]).isdigit() else 10**9,
            r["num"],
        )
    )
    for i, r in enumerate(rows_out, 1):
        r["npp"] = i
    return {
        "count": len(rows_out),
        "modules_count": len(catalog),
        "rows": rows_out,
    }


def commission_num_set(user: Optional[dict] = None) -> Set[str]:
    data = commission_list(user)
    return {_norm(str(r.get("num") or "")) for r in (data.get("rows") or []) if r.get("num")}


def filter_options(user: Optional[dict] = None) -> Dict[str, Any]:
    """Фильтры ведомости = те же потоки/группы/курсанты, что в «Результаты»."""
    groups = _results_groups(user)
    streams = sorted(
        {g["stream_num"] for g in groups if g.get("stream_num")},
        key=lambda x: (len(x), x),
    )
    group_opts = []
    cadets_by_group = {}
    for g in groups:
        rows = list(g.get("cadets") or [])
        key = g["stream_num"] + "::" + g["group_num"]
        cadets_by_group[key] = rows
        group_opts.append(
            {
                "stream_num": g["stream_num"],
                "group_num": g["group_num"],
                "id": g.get("id") or "",
                "distribution_id": g.get("distribution_id") or "",
                "label": f"Поток {g['stream_num']} · группа {g['group_num']}",
                "cadets_count": len(rows),
                "period_from": g.get("period_from") or "",
                "period_to": g.get("period_to") or "",
            }
        )
    visible = auth_visible_tests(user)
    module_idx = _catalog_module_index()
    tests = [
        {
            "id": t.get("id"),
            "title": t.get("title") or "",
            "label": _test_column_label(t, module_idx),
            "is_module": bool(
                (t.get("source_module_id") or "").strip()
                or t.get("published_for_all")
            ),
        }
        for t in visible
        if t.get("id")
    ]
    return {
        "streams": streams,
        "groups": group_opts,
        "tests": tests,
        "cadets_by_group": cadets_by_group,
        "scope": "results",
    }


def auth_visible_tests(user: Optional[dict]) -> List[Dict[str, Any]]:
    from . import auth

    all_tests = db.list_tests(include_module_copies=True) or []
    ids = auth.visible_test_ids(user) if user else None
    if ids is None:
        return all_tests
    idset = set(ids)
    return [t for t in all_tests if t.get("id") in idset]


def build_statement(
    *,
    streams: Sequence[str],
    groups: Sequence[Dict[str, str]],
    cadet_nums: Sequence[str],
    test_ids: Sequence[str],
    user: Optional[dict] = None,
) -> Dict[str, Any]:
    """Собрать таблицы ведомости по фильтрам (выборка как в «Результаты»)."""
    allowed = _results_groups(user)
    results_groups = {
        (_norm(g["stream_num"]), _norm(g["group_num"])): g for g in allowed
    }
    if not results_groups:
        raise ValueError(
            "Нет курсантов в «Результаты» для формирования ведомости"
        )

    stream_set = {_norm(s) for s in streams if _norm(s)}
    group_keys: Set[Tuple[str, str]] = set()
    for g in groups or []:
        sn = _norm(str(g.get("stream_num") or g.get("stream") or ""))
        gn = _norm(str(g.get("group_num") or g.get("group") or ""))
        if sn and gn:
            group_keys.add((sn, gn))
    if stream_set and not group_keys:
        for sk, gk in results_groups:
            if sk in stream_set:
                group_keys.add((sk, gk))
    if not group_keys:
        group_keys = set(results_groups.keys())

    group_keys = {k for k in group_keys if k in results_groups}
    if stream_set:
        group_keys = {k for k in group_keys if k[0] in stream_set}

    cadet_filter = {_norm(str(n)) for n in (cadet_nums or []) if _norm(str(n))}
    test_ids = [str(t).strip() for t in (test_ids or []) if str(t).strip()]
    if not test_ids:
        raise ValueError("Выберите хотя бы один тест")
    if not group_keys:
        raise ValueError("Выберите хотя бы одну группу из «Результаты»")

    visible = {t.get("id"): t for t in auth_visible_tests(user)}
    for tid in test_ids:
        if tid not in visible:
            raise ValueError("Нет доступа к одному из выбранных тестов")
    module_idx = _catalog_module_index()
    columns = []
    for tid in test_ids:
        t = visible[tid]
        columns.append(
            {
                "test_id": tid,
                "title": t.get("title") or "",
                "label": _test_column_label(t, module_idx),
            }
        )

    attempts = _visible_attempts(user)
    best = _best_grades(attempts, test_ids)
    commission_nums = commission_num_set(user)

    tables = []
    for sk, gk in sorted(group_keys, key=lambda x: (x[0], x[1])):
        gmeta = results_groups[(sk, gk)]
        cadets = list(gmeta.get("cadets") or [])
        if cadet_filter:
            cadets = [c for c in cadets if c["num"] in cadet_filter]
        # стабильный порядок
        cadets.sort(
            key=lambda c: (
                int(c["num"]) if c["num"].isdigit() else 10**9,
                c["num"],
            )
        )
        rows = []
        for i, c in enumerate(cadets, 1):
            grades = []
            missing = False
            cells = []
            for col in columns:
                g = best.get((c["num"], col["test_id"]))
                if g is None:
                    missing = True
                    cells.append(None)
                else:
                    # показывать как int если целое
                    val = int(g) if float(g).is_integer() else g
                    cells.append(val)
                    grades.append(float(g))
            avg = round(sum(grades) / len(grades), 2) if grades else None
            on_commission = c["num"] in commission_nums
            rows.append(
                {
                    "npp": i,
                    "num": c["num"],
                    "callsign": c["callsign"] or "—",
                    "grades": cells,
                    "average": avg,
                    "incomplete": missing,
                    "commission": on_commission,
                }
            )
        tables.append(
            {
                "stream_num": sk,
                "group_num": gk,
                "period_from": gmeta.get("period_from") or "",
                "period_to": gmeta.get("period_to") or "",
                "period_label": period_label(
                    gmeta.get("period_from") or "", gmeta.get("period_to") or ""
                ),
                "header_line": _header_line(sk, gk),
                "staff": gmeta.get("staff") or [],
                "rows": rows,
            }
        )

    return {
        "columns": columns,
        "tables": tables,
        "commission_nums": sorted(commission_nums),
    }


def _xlsx_apply_table_borders(ws, r1: int, r2: int, c1: int, c2: int) -> None:
    """Тонкие внутренние + толстые внешние границы; у строки заголовков — толстый контур."""
    from openpyxl.styles import Border, Side

    thin_s = Side(style="thin", color="000000")
    thick_s = Side(style="medium", color="000000")
    header_row = r1

    for r in range(r1, r2 + 1):
        for c in range(c1, c2 + 1):
            cell = ws.cell(r, c)
            left = thick_s if c == c1 else thin_s
            right = thick_s if c == c2 else thin_s
            top = thick_s if r == r1 else thin_s
            bottom = thick_s if r == r2 else thin_s
            # контур строки заголовков столбцов — толстый со всех внешних сторон строки
            if r == header_row:
                top = thick_s
                bottom = thick_s
                if c == c1:
                    left = thick_s
                if c == c2:
                    right = thick_s
            cell.border = Border(left=left, right=right, top=top, bottom=bottom)


def build_statement_xlsx(payload: Dict[str, Any]) -> bytes:
    """Excel по образцу «Ведомость сдачи модулей»."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.page import PageMargins

    columns = payload.get("columns") or []
    tables = payload.get("tables") or []
    if not tables:
        raise ValueError("Нет данных для ведомости")

    wb = Workbook()
    default = wb.active
    font = Font(name="Calibri", size=12)
    font_bold = Font(name="Calibri", size=12, bold=True)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center", wrap_text=False)
    staff_left = Alignment(horizontal="left", vertical="bottom", wrap_text=False)
    staff_center = Alignment(horizontal="center", vertical="bottom", wrap_text=False)
    data_row_height = 18
    staff_left = Alignment(horizontal="left", vertical="bottom", wrap_text=False)
    staff_center = Alignment(horizontal="center", vertical="bottom", wrap_text=False)
    data_row_height = 18
    thin_side = Side(style="thin", color="000000")
    thin = Border(
        left=thin_side, right=thin_side, top=thin_side, bottom=thin_side
    )
    warn_fill = PatternFill("solid", fgColor="F8D7DA")
    commission_fill = PatternFill("solid", fgColor="FF6B7A")

    headers = ["№ п/п", "Номер", "Позывной"] + [
        c.get("label") or c.get("title") or "Тест" for c in columns
    ] + ["Средний балл", "Подпись"]
    n_cols = len(headers)
    # Должность | (зазор + линия подписи) | ФИО
    staff_label_end = min(3, max(1, n_cols - 2))
    staff_sign_col = min(staff_label_end + 1, n_cols)
    staff_fio_start = min(staff_sign_col + 1, n_cols)
    staff_fio_end = n_cols

    for ti, table in enumerate(tables):
        title = f"П{table.get('stream_num')}_Г{table.get('group_num')}"
        safe = re.sub(r"[\\/*?:\[\]]", "_", title)[:28] or f"Группа{ti+1}"
        if ti == 0:
            ws = default
            ws.title = safe
        else:
            ws = wb.create_sheet(safe)

        for ci, h in enumerate(headers, 1):
            letter = get_column_letter(ci)
            text_len = max(len(str(h or "")), 4)
            if ci == 1:
                w = 7.0
            elif ci == 2:
                w = max(14.0, min(18.0, text_len + 3))
            elif ci == 3:
                w = max(14.0, min(20.0, text_len + 3))
            elif ci >= n_cols - 1:
                w = max(13.0, min(16.0, text_len * 1.15 + 1))
            else:
                w = max(10.0, min(16.0, text_len * 1.2 + 1))
            ws.column_dimensions[letter].width = w
        # зона должности шире «Ассистент инструктора:»
        label_need = 26.0
        cur_label = sum(
            float(ws.column_dimensions[get_column_letter(i)].width or 0)
            for i in range(1, staff_label_end + 1)
        )
        if cur_label < label_need and staff_label_end >= 2:
            deficit = label_need - cur_label
            b_letter = get_column_letter(min(2, staff_label_end))
            ws.column_dimensions[b_letter].width = (
                float(ws.column_dimensions[b_letter].width or 12) + deficit
            )
        # колонка подписи между должностью и ФИО — заметный зазор
        if staff_sign_col != staff_fio_start:
            ws.column_dimensions[get_column_letter(staff_sign_col)].width = max(
                float(
                    ws.column_dimensions[get_column_letter(staff_sign_col)].width or 0
                ),
                16.0,
            )

        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_cols)
        c1 = ws.cell(
            1,
            1,
            table.get("header_line")
            or _header_line(table.get("stream_num") or "", table.get("group_num") or ""),
        )
        c1.font = font_bold
        c1.alignment = center
        ws.row_dimensions[1].height = 20

        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n_cols)
        c2 = ws.cell(2, 1, table.get("period_label") or "Период не задан")
        c2.font = font_bold
        c2.alignment = center
        ws.row_dimensions[2].height = 20

        for ci, h in enumerate(headers, 1):
            cell = ws.cell(3, ci, h)
            cell.font = font_bold
            cell.alignment = center
            cell.border = thin
        ws.row_dimensions[3].height = 32

        first_grade_col = 4
        last_grade_col = 3 + len(columns)
        avg_col = last_grade_col + 1
        sign_col = avg_col + 1

        for ri, row in enumerate(table.get("rows") or [], 4):
            vals = [
                row.get("npp"),
                row.get("num"),
                row.get("callsign"),
            ] + list(row.get("grades") or [])
            while len(vals) < 3 + len(columns):
                vals.append(None)
            row_fill = (
                commission_fill
                if row.get("commission")
                else (warn_fill if row.get("incomplete") else None)
            )
            for ci, v in enumerate(vals, 1):
                cell = ws.cell(ri, ci, v if v is not None else None)
                cell.font = font
                cell.alignment = center
                cell.border = thin
                if row_fill is not None:
                    cell.fill = row_fill
            if columns:
                start = get_column_letter(first_grade_col)
                end = get_column_letter(last_grade_col)
                cell = ws.cell(
                    ri,
                    avg_col,
                    f'=IF(COUNT({start}{ri}:{end}{ri})=0,"",AVERAGE({start}{ri}:{end}{ri}))',
                )
            else:
                cell = ws.cell(ri, avg_col, None)
            cell.font = font
            cell.alignment = center
            cell.border = thin
            if row_fill is not None:
                cell.fill = row_fill
            cell_s = ws.cell(ri, sign_col, None)
            cell_s.font = font
            cell_s.alignment = center
            cell_s.border = thin
            if row_fill is not None:
                cell_s.fill = row_fill
            ws.row_dimensions[ri].height = data_row_height

        last_data = 3 + len(table.get("rows") or [])
        if last_data < 3:
            last_data = 3
        _xlsx_apply_table_borders(ws, 3, last_data, 1, n_cols)

        staff_row = last_data + 2
        staff = table.get("staff") or []
        instructors = [s for s in staff if s.get("role") == "instructor"]
        assistants = [s for s in staff if s.get("role") == "assistant"]
        if not instructors and not assistants and staff:
            instructors = staff[:1]
            assistants = staff[1:]

        def write_staff_line(r: int, label: str, person: Optional[Dict[str, Any]]) -> int:
            """Должность … линия подписи … ФИО — с зазором между зонами."""
            if staff_label_end > 1:
                ws.merge_cells(
                    start_row=r, start_column=1, end_row=r, end_column=staff_label_end
                )
            cell_l = ws.cell(r, 1, label)
            cell_l.font = font
            cell_l.alignment = staff_left

            fio = ""
            if person:
                fio = (
                    person.get("short")
                    or _short_fio(person.get("fio") or "")
                    or person.get("fio")
                    or ""
                ).strip()

            # линия подписи = толстая нижняя граница ячейки (не текст по центру строки)
            sign_side = Side(style="medium", color="000000")
            if staff_sign_col < staff_fio_start:
                cell_sign = ws.cell(r, staff_sign_col, None)
                cell_sign.font = font
                cell_sign.alignment = staff_center
                cell_sign.border = Border(bottom=sign_side)
                if staff_fio_start < staff_fio_end:
                    ws.merge_cells(
                        start_row=r,
                        start_column=staff_fio_start,
                        end_row=r,
                        end_column=staff_fio_end,
                    )
                cell_f = ws.cell(r, staff_fio_start, fio or "")
                cell_f.font = font
                cell_f.alignment = staff_left
            else:
                cell_f = ws.cell(r, staff_sign_col, fio or "")
                cell_f.font = font
                cell_f.alignment = staff_left
                cell_f.border = Border(bottom=sign_side)
            ws.row_dimensions[r].height = data_row_height
            return r + 2

        r = staff_row
        if instructors:
            for p in instructors:
                r = write_staff_line(r, "Инструктор:", p)
        else:
            r = write_staff_line(r, "Инструктор:", None)
        if assistants:
            for p in assistants:
                r = write_staff_line(r, "Ассистент инструктора:", p)
        else:
            r = write_staff_line(r, "Ассистент инструктора:", None)

        last_row = max(r - 1, last_data)
        ws.print_area = f"A1:{get_column_letter(n_cols)}{last_row}"
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.orientation = "landscape" if n_cols > 8 else "portrait"
        ws.page_setup.fitToPage = True
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.page_setup.horizontalCentered = True
        try:
            ws.sheet_properties.pageSetUpPr.fitToPage = True
        except Exception:
            pass
        ws.page_margins = PageMargins(
            left=0.5, right=0.5, top=0.5, bottom=0.5, header=0.2, footer=0.2
        )
        ws.print_title_rows = "1:3"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
