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


def _catalog_module_index() -> Dict[str, int]:
    """id канона → № модуля (1-based), по возрастанию created_at."""
    rows = list(db.list_published_catalog() or [])
    rows.sort(key=lambda t: (t.get("created_at") or "", t.get("title") or ""))
    return {str(t.get("id") or ""): i for i, t in enumerate(rows, 1) if t.get("id")}


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


def _short_fio(fio: str) -> str:
    return board_writeoff.short_fio(fio)


def _sees_all_dist_groups(user: Optional[dict]) -> bool:
    role = ((user or {}).get("role") or "").strip()
    return role in ("admin", "senior")


def _user_staff_id(user: Optional[dict]) -> str:
    return ((user or {}).get("staff_id") or "").strip()


def _group_staff_ids(instructors: Sequence[Dict[str, Any]], assistants: Sequence[Dict[str, Any]]) -> Set[str]:
    ids: Set[str] = set()
    for p in list(instructors or []) + list(assistants or []):
        sid = (p.get("id") or "").strip()
        if sid:
            ids.add(sid)
    return ids


def _iter_dist_groups(user: Optional[dict] = None) -> List[Dict[str, Any]]:
    """Плоский список групп из распределений с cadets/staff/period.

    Admin/senior — все группы документов распределения.
    Инструктор/ассистент — только группы, где в составе указан staff_id
    активной учётной записи.
    """
    see_all = _sees_all_dist_groups(user)
    staff_id = _user_staff_id(user)
    if not see_all and not staff_id:
        return []

    out: List[Dict[str, Any]] = []
    seen_keys: Set[Tuple[str, str]] = set()
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
                instructors = g.get("instructors") or []
                assistants = g.get("assistants") or []
                if not see_all:
                    if staff_id not in _group_staff_ids(instructors, assistants):
                        continue
                group_num = _norm(str(g.get("group_num") or ""))
                if not stream_num or not group_num:
                    continue
                key = (stream_num, group_num)
                # одно и то же поток+группа из более нового документа — первое
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                g_from = g.get("period_from") or s_from
                g_to = g.get("period_to") or s_to
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
                out.append(
                    {
                        "id": g.get("id") or "",
                        "distribution_id": did,
                        "stream_num": stream_num,
                        "group_num": group_num,
                        "period_from": g_from or "",
                        "period_to": g_to or "",
                        "cadets": g.get("cadets") or [],
                        "staff": staff,
                    }
                )
    return out


def _cadets_from_global(stream_num: str, group_num: str) -> List[Dict[str, Any]]:
    sk = _norm_key(stream_num)
    gk = _norm_key(group_num)
    rows = []
    with db.connect() as conn:
        for r in conn.execute(
            """
            SELECT student_num, callsign, full_name, group_num, stream_num, seq
            FROM cadets
            WHERE TRIM(COALESCE(student_num,''))<>''
            ORDER BY seq, student_num
            """
        ).fetchall():
            d = dict(r)
            if _norm_key(str(d.get("stream_num") or "")) != sk:
                continue
            if _norm_key(str(d.get("group_num") or "")) != gk:
                continue
            rows.append(
                {
                    "num": _norm(str(d.get("student_num") or "")),
                    "callsign": _norm(d.get("callsign") or ""),
                    "fio": _norm(d.get("full_name") or ""),
                }
            )
    return rows


def _group_cadet_rows(group: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = []
    for c in group.get("cadets") or []:
        num = _norm(str(c.get("num") or c.get("student_num") or ""))
        if not num:
            continue
        rows.append(
            {
                "num": num,
                "callsign": _norm(c.get("callsign") or ""),
                "fio": _norm(c.get("fio") or c.get("full_name") or ""),
            }
        )
    if rows:
        return rows
    return _cadets_from_global(group.get("stream_num") or "", group.get("group_num") or "")


def filter_options(user: Optional[dict] = None) -> Dict[str, Any]:
    """Справочники для фильтров модалки — только из распределения и по доступу."""
    groups = _iter_dist_groups(user)
    streams = sorted(
        {g["stream_num"] for g in groups if g.get("stream_num")},
        key=lambda x: (len(x), x),
    )
    group_opts = []
    cadets_by_group = {}
    for g in groups:
        rows = _group_cadet_rows(g)
        key = g["stream_num"] + "::" + g["group_num"]
        cadets_by_group[key] = rows
        group_opts.append(
            {
                "stream_num": g["stream_num"],
                "group_num": g["group_num"],
                "id": g["id"],
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
        "scope": "all" if _sees_all_dist_groups(user) else "assigned",
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
    """Собрать таблицы ведомости по фильтрам."""
    allowed = _iter_dist_groups(user)
    dist_groups = {
        (_norm(g["stream_num"]), _norm(g["group_num"])): g for g in allowed
    }
    if not dist_groups:
        raise ValueError(
            "Нет доступных групп в распределении для этой учётной записи"
        )

    stream_set = {_norm(s) for s in streams if _norm(s)}
    group_keys: Set[Tuple[str, str]] = set()
    for g in groups or []:
        sn = _norm(str(g.get("stream_num") or g.get("stream") or ""))
        gn = _norm(str(g.get("group_num") or g.get("group") or ""))
        if sn and gn:
            group_keys.add((sn, gn))
    if stream_set and not group_keys:
        for sk, gk in dist_groups:
            if sk in stream_set:
                group_keys.add((sk, gk))
    if not group_keys:
        # ничего не выбрано — все доступные группы
        group_keys = set(dist_groups.keys())

    # только группы из распределения и в зоне доступа учётки
    group_keys = {k for k in group_keys if k in dist_groups}
    if stream_set:
        group_keys = {k for k in group_keys if k[0] in stream_set}

    cadet_filter = {_norm(str(n)) for n in (cadet_nums or []) if _norm(str(n))}
    test_ids = [str(t).strip() for t in (test_ids or []) if str(t).strip()]
    if not test_ids:
        raise ValueError("Выберите хотя бы один тест")
    if not group_keys:
        raise ValueError("Выберите хотя бы одну доступную группу")

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

    attempts = db.list_attempts()
    from . import auth

    vids = auth.visible_test_ids(user) if user else None
    if vids is not None:
        idset = set(vids)
        attempts = [a for a in attempts if a.get("test_id") in idset]
    best = _best_grades(attempts, test_ids)

    tables = []
    for sk, gk in sorted(group_keys, key=lambda x: (x[0], x[1])):
        gmeta = dist_groups[(sk, gk)]
        cadets = _group_cadet_rows(gmeta)
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
            rows.append(
                {
                    "npp": i,
                    "num": c["num"],
                    "callsign": c["callsign"] or "—",
                    "grades": cells,
                    "average": avg,
                    "incomplete": missing,
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
                "header_line": f"Поток №{sk}  Группа {gk}",
                "staff": gmeta.get("staff") or [],
                "rows": rows,
            }
        )

    return {
        "columns": columns,
        "tables": tables,
    }


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
    # удалить дефолтный лист после создания рабочих
    default = wb.active
    font = Font(name="Calibri", size=12)
    font_bold = Font(name="Calibri", size=12, bold=True)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center")
    thin = Border(
        left=Side(style="thin", color="000000"),
        right=Side(style="thin", color="000000"),
        top=Side(style="thin", color="000000"),
        bottom=Side(style="thin", color="000000"),
    )
    warn_fill = PatternFill("solid", fgColor="F8D7DA")

    headers = ["№ п/п", "Номер", "Позывной"] + [
        c.get("label") or c.get("title") or "Тест" for c in columns
    ] + ["Средний балл", "Подпись"]
    n_cols = len(headers)

    for ti, table in enumerate(tables):
        title = f"П{table.get('stream_num')}_Г{table.get('group_num')}"
        safe = re.sub(r"[\\/*?:\[\]]", "_", title)[:28] or f"Группа{ti+1}"
        if ti == 0:
            ws = default
            ws.title = safe
        else:
            ws = wb.create_sheet(safe)

        # ширины от заголовков
        for ci, h in enumerate(headers, 1):
            letter = get_column_letter(ci)
            if ci == 1:
                w = 6.5
            elif ci == 2:
                w = max(12, min(18, len(str(h)) + 2))
            elif ci == 3:
                w = max(12, min(20, len(str(h)) + 2))
            elif ci >= n_cols - 1:
                w = max(12, min(16, len(str(h)) * 1.1))
            else:
                w = max(8, min(14, len(str(h)) * 1.15))
            ws.column_dimensions[letter].width = w

        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_cols)
        c1 = ws.cell(1, 1, table.get("header_line") or "")
        c1.font = font_bold
        c1.alignment = left

        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n_cols)
        c2 = ws.cell(2, 1, table.get("period_label") or "Период не задан")
        c2.font = font_bold
        c2.alignment = left

        for ci, h in enumerate(headers, 1):
            cell = ws.cell(3, ci, h)
            cell.font = font
            cell.alignment = center
            cell.border = thin

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
            # pad grades
            while len(vals) < 3 + len(columns):
                vals.append(None)
            for ci, v in enumerate(vals, 1):
                cell = ws.cell(ri, ci, v if v is not None else None)
                cell.font = font
                cell.alignment = center
                cell.border = thin
                if row.get("incomplete"):
                    cell.fill = warn_fill
            # AVERAGE formula over grade columns
            if columns:
                start = get_column_letter(first_grade_col)
                end = get_column_letter(last_grade_col)
                cell = ws.cell(ri, avg_col, f"=AVERAGE({start}{ri}:{end}{ri})")
            else:
                cell = ws.cell(ri, avg_col, None)
            cell.font = font
            cell.alignment = center
            cell.border = thin
            if row.get("incomplete"):
                cell.fill = warn_fill
            cell_s = ws.cell(ri, sign_col, None)
            cell_s.font = font
            cell_s.border = thin
            if row.get("incomplete"):
                cell_s.fill = warn_fill

        last_data = 3 + len(table.get("rows") or [])
        staff_row = last_data + 2
        staff = table.get("staff") or []
        # Инструктор / ассистенты
        instructors = [s for s in staff if s.get("role") == "instructor"]
        assistants = [s for s in staff if s.get("role") == "assistant"]
        if not instructors and not assistants and staff:
            instructors = staff[:1]
            assistants = staff[1:]

        def write_staff_line(r: int, label: str, person: Optional[Dict[str, Any]]) -> int:
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
            ws.cell(r, 1, label).font = font
            fio = ""
            if person:
                fio = (person.get("short") or _short_fio(person.get("fio") or "") or person.get("fio") or "").strip()
            line = (fio + " ____________") if fio else "____________"
            ws.cell(r, 3, line).font = font
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

        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_setup.orientation = "landscape" if n_cols > 10 else "portrait"
        ws.page_setup.fitToPage = True
        ws.page_setup.fitToWidth = 1
        ws.page_setup.fitToHeight = 0
        ws.page_margins = PageMargins(left=0.5, right=0.5, top=0.5, bottom=0.5)
        ws.print_title_rows = "1:3"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
