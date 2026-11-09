# -*- coding: utf-8 -*-
"""Адаптер «кривого» исходного Excel распределения (формат штаба SHM).

Секции вида «… 36 поток …» + строки групп с составом ФИО.
Хвост (командировки/больничные) отбрасывается.
"""

from __future__ import annotations

import io
import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from .training import resolve_staff_by_fio, split_people

_SECTION_RE = re.compile(
    r"(?P<head>.*?)(?P<stream>\d+(?:[.,]\d+)?)\s*поток",
    re.IGNORECASE | re.DOTALL,
)
_DATE_RE = re.compile(
    r"(?:с\s*)?(?P<d>\d{1,2})[./](?P<m>\d{1,2})(?:[./](?P<y>\d{2,4}))?",
    re.IGNORECASE,
)
_TENT_RE = re.compile(r"палатк[аи]\s*(\d+)", re.IGNORECASE)
_TAIL_RE = re.compile(
    r"командировк|больничн|отпуск|повышение\s*квалификац",
    re.IGNORECASE,
)
_ITOG_RE = re.compile(r"^\s*итого\b", re.IGNORECASE)
_FIO_LIKE_RE = re.compile(
    r"^[А-ЯЁA-Z][а-яёa-z\-]+(?:\s+[А-ЯЁA-Z][а-яёa-z\-]+){0,3}$"
)


def _cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def _is_group_num(v: Any) -> Optional[str]:
    s = _cell(v)
    if not s:
        return None
    if re.fullmatch(r"\d{1,4}(?:[.,]\d+)?", s):
        return s.replace(",", ".")
    return None


def _parse_intish(v: Any) -> Optional[int]:
    s = _cell(v)
    if not s:
        return None
    if re.fullmatch(r"\d{1,4}", s):
        return int(s)
    # «107 (1)» — не план группы
    m = re.fullmatch(r"(\d{1,4})", s.split()[0]) if s.split() else None
    if m and "(" not in s:
        return int(m.group(1))
    return None


def _guess_year(filename: str = "", override: Optional[int] = None) -> int:
    if override and 2000 <= int(override) <= 2100:
        return int(override)
    m = re.search(r"(20\d{2})", filename or "")
    if m:
        return int(m.group(1))
    # «06.11» в имени без года — текущий / ближайший учебный
    return date.today().year


def _parse_period_from(text: str, year: int) -> str:
    m = _DATE_RE.search(text or "")
    if not m:
        return ""
    d, mo = int(m.group("d")), int(m.group("m"))
    y_raw = m.group("y")
    if y_raw:
        y = int(y_raw)
        if y < 100:
            y += 2000
    else:
        y = year
    try:
        return f"{y:04d}-{mo:02d}-{d:02d}"
    except Exception:
        return ""


def _fio_tokens(*parts: str) -> List[str]:
    out: List[str] = []
    for p in parts:
        for name in split_people(p or ""):
            # отсечь «чел 150», коды отделов
            if _parse_intish(name) is not None:
                continue
            if len(name) < 3:
                continue
            if not re.search(r"[А-ЯЁа-яёA-Za-z]", name):
                continue
            # «Отдел разработок» — не ФИО
            if re.search(r"отдел|разработ|вкс|обас|барс", name, re.I):
                continue
            out.append(name)
    return out


def _looks_like_section(b: str) -> bool:
    if not b:
        return False
    if _ITOG_RE.search(b):
        return False
    if _TAIL_RE.search(b):
        return False
    return bool(re.search(r"поток", b, re.I)) and bool(
        re.search(r"\d", b)
    )


def _parse_section(b: str, c: str, d: str, year: int) -> Dict[str, Any]:
    stream = ""
    m = _SECTION_RE.search(b)
    if m:
        stream = (m.group("stream") or "").replace(",", ".")
    else:
        m2 = re.search(r"(\d+(?:[.,]\d+)?)\s*поток", b, re.I)
        if m2:
            stream = m2.group(1).replace(",", ".")
    period_from = _parse_period_from(b, year)
    org = ""
    m_org = re.search(r"\(([^)]+)\)\s*$", b)
    if m_org:
        org = m_org.group(1).strip()
    seniors = _fio_tokens(c, d)
    return {
        "stream": stream,
        "period_from": period_from,
        "period_to": "",
        "seniors": seniors,
        "seniors_text": ", ".join(seniors),
        "polygon": "",
        "org": org,
        "raw": b,
    }


def _parse_place(e: str) -> Tuple[str, str]:
    """Возвращает (classroom, tent_num)."""
    s = _cell(e)
    if not s:
        return "", ""
    m = _TENT_RE.search(s)
    if m:
        return "", m.group(1)
    return s, ""


def _load_rows_xlsx(raw: bytes) -> List[List[Any]]:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    try:
        ws = wb.active
        rows: List[List[Any]] = []
        for row in ws.iter_rows(values_only=True):
            if not row:
                continue
            cells = list(row[:8])
            if all(c is None or str(c).strip() == "" for c in cells):
                continue
            rows.append(cells)
        return rows
    finally:
        wb.close()


def _load_rows_xls(raw: bytes) -> List[List[Any]]:
    try:
        import xlrd
    except ImportError as e:
        raise ValueError(
            "Для .xls нужен пакет xlrd. Сохраните файл как .xlsx или установите xlrd."
        ) from e
    book = xlrd.open_workbook(file_contents=raw)
    sheet = book.sheet_by_index(0)
    rows: List[List[Any]] = []
    for r in range(sheet.nrows):
        cells = [sheet.cell_value(r, c) for c in range(min(8, sheet.ncols))]
        if all(_cell(c) == "" for c in cells):
            continue
        rows.append(cells)
    return rows


def load_source_rows(raw: bytes, filename: str = "") -> List[List[Any]]:
    name = (filename or "").lower()
    if name.endswith(".xls") and not name.endswith(".xlsx") and not name.endswith(".xlsm"):
        return _load_rows_xls(raw)
    # иногда .xls по расширению, но внутри zip/xlsx
    try:
        return _load_rows_xlsx(raw)
    except Exception:
        if name.endswith(".xls"):
            return _load_rows_xls(raw)
        raise


def passport_from_filename(filename: str, year: int) -> Dict[str, str]:
    base = re.sub(r"\.(xlsx|xlsm|xls)$", "", filename or "", flags=re.I)
    base = re.sub(r"[_\s]+", " ", base).strip() or "Распределение"
    # «Распределение_на_  06.11» → дата
    dist_date = ""
    m = re.search(r"(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?", base)
    if m:
        d, mo = int(m.group(1)), int(m.group(2))
        y = int(m.group(3)) if m.group(3) else year
        if y < 100:
            y += 2000
        try:
            dist_date = f"{y:04d}-{mo:02d}-{d:02d}"
            title = f"Распределение на {d:02d}.{mo:02d}.{y}"
        except Exception:
            title = base
    else:
        title = base
    return {
        "title": title,
        "dist_date": dist_date,
        "note": "Импорт из исходного файла" + (f" «{filename}»" if filename else ""),
    }


def parse_shm_source_distribution(
    raw: bytes,
    *,
    filename: str = "",
    year: Optional[int] = None,
) -> Dict[str, Any]:
    """Разбор исходного файла → паспорт + группы (канонические поля импорта)."""
    y = _guess_year(filename, year)
    rows = load_source_rows(raw, filename)
    passport = passport_from_filename(filename, y)
    warnings: List[str] = []
    groups: List[Dict[str, Any]] = []
    streams_meta: Dict[str, Dict[str, Any]] = {}
    current: Optional[Dict[str, Any]] = None
    stopped = False

    for idx, cells in enumerate(rows, start=1):
        while len(cells) < 6:
            cells.append(None)
        a, b, c, d, e, f = (_cell(cells[i]) if i < len(cells) else "" for i in range(6))
        # сырые для чисел
        a_raw, c_raw, d_raw, e_raw = (
            cells[0] if len(cells) > 0 else None,
            cells[2] if len(cells) > 2 else None,
            cells[3] if len(cells) > 3 else None,
            cells[4] if len(cells) > 4 else None,
        )

        joined = " ".join(x for x in (a, b, c, d, e, f) if x)
        if _TAIL_RE.search(joined) and not _is_group_num(a_raw):
            # хвост документа
            if current is not None:
                stopped = True
            continue
        if stopped:
            continue

        if _ITOG_RE.search(b) or _ITOG_RE.search(c) or (a == "" and _ITOG_RE.search(joined)):
            continue

        # заголовок таблицы
        if re.search(r"номер\s*группы", b + a, re.I) or (
            re.search(r"номер\s*группы", a, re.I)
        ):
            continue
        if re.search(r"фио", b, re.I) and re.search(r"должность|старш", joined, re.I):
            continue

        gnum = _is_group_num(a_raw)
        if gnum is None and _looks_like_section(b):
            current = _parse_section(b, c, d, y)
            if not current.get("stream"):
                warnings.append(f"Строка {idx}: секция без номера потока: {b[:80]}")
                current = None
                continue
            sid = current["stream"]
            if sid in streams_meta:
                warnings.append(f"Строка {idx}: повтор секции потока {sid}")
            streams_meta[sid] = current
            continue

        if gnum is None:
            continue
        if current is None:
            warnings.append(f"Строка {idx}: группа {gnum} вне секции потока — пропуск")
            continue

        staff_names = _fio_tokens(b)
        classroom, tent = _parse_place(_cell(e_raw) if e_raw is not None else e)
        planned = _parse_intish(d_raw)
        if planned is None:
            planned = _parse_intish(c_raw)
            if planned is None:
                planned = 0
                if _cell(d_raw) or (_cell(c_raw) and not re.search(r"отдел", _cell(c_raw), re.I)):
                    warnings.append(
                        f"Поток {current['stream']} группа {gnum}: не удалось прочитать план курсантов"
                    )

        note_parts = []
        if f:
            note_parts.append(f)
        if current.get("org") and current["org"] not in (f or ""):
            # org на уровне потока — в note группы не дублируем каждый раз; полигон пуст
            pass
        # мусор из C если текст
        c_txt = _cell(c_raw)
        if c_txt and _parse_intish(c_raw) is None and not re.fullmatch(r"[\d\s,]+", c_txt):
            if not re.search(r"отдел", c_txt, re.I):
                pass  # числа вида «9, 3» игнор
            else:
                note_parts.append(c_txt)

        groups.append(
            {
                "stream": current["stream"],
                "group": gnum,
                "period_from": current.get("period_from") or "",
                "period_to": current.get("period_to") or "",
                "seniors": current.get("seniors_text") or "",
                "polygon": current.get("polygon") or "",
                "count": str(planned),
                "instructor": staff_names[0] if staff_names else "",
                "assistants": ", ".join(staff_names[1:]) if len(staff_names) > 1 else "",
                "staff_names": staff_names,
                "classroom": classroom,
                "tent": tent,
                "note": "; ".join(note_parts),
                "source_row": idx,
            }
        )

    if not groups:
        raise ValueError(
            "Не удалось найти группы в исходном файле. "
            "Ожидаются секции с «N поток» и строки с номером группы."
        )

    # сводка потоков
    streams = []
    for sid, meta in streams_meta.items():
        n = sum(1 for g in groups if g["stream"] == sid)
        streams.append(
            {
                "stream": sid,
                "period_from": meta.get("period_from") or "",
                "seniors": meta.get("seniors") or [],
                "org": meta.get("org") or "",
                "groups_count": n,
                "raw": meta.get("raw") or "",
            }
        )

    return {
        "format": "shm_source",
        "passport": passport,
        "year": y,
        "streams": streams,
        "groups": groups,
        "warnings": warnings,
        "stats": {
            "streams": len(streams),
            "groups": len(groups),
        },
    }


def enrich_preview_with_staff(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Резолв ФИО → штатка для превью (без записи в БД)."""
    unmatched: List[str] = []
    seen_miss = set()

    def resolve_list(names: List[str]) -> List[Dict[str, str]]:
        out = []
        for fio in names:
            st = resolve_staff_by_fio(fio)
            if st:
                out.append(
                    {
                        "query": fio,
                        "id": st.get("id") or "",
                        "fio": st.get("fio") or fio,
                        "found": True,
                    }
                )
            else:
                out.append({"query": fio, "id": "", "fio": fio, "found": False})
                key = fio.casefold()
                if key not in seen_miss:
                    seen_miss.add(key)
                    unmatched.append(fio)
        return out

    for s in parsed.get("streams") or []:
        s["seniors_resolved"] = resolve_list(list(s.get("seniors") or []))

    for g in parsed.get("groups") or []:
        names = list(g.get("staff_names") or [])
        if not names:
            # fallback из instructor/assistants
            names = _fio_tokens(g.get("instructor") or "", g.get("assistants") or "")
        resolved = resolve_list(names)
        g["staff_resolved"] = resolved
        found = [x for x in resolved if x.get("found")]
        g["instructor_resolved"] = found[0] if found else None
        g["assistants_resolved"] = found[1:] if len(found) > 1 else []

    parsed["unmatched_staff"] = unmatched
    return parsed


def build_canonical_rows(parsed: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Строки для distributions.import_distribution_row."""
    rows = []
    for g in parsed.get("groups") or []:
        rows.append(
            {
                "stream": g.get("stream") or "",
                "group": g.get("group") or "",
                "period_from": g.get("period_from") or "",
                "period_to": g.get("period_to") or "",
                "seniors": g.get("seniors") or "",
                "polygon": g.get("polygon") or "",
                "count": g.get("count") or "0",
                "instructor": g.get("instructor") or "",
                "assistants": g.get("assistants") or "",
                "classroom": g.get("classroom") or "",
                "tent": g.get("tent") or "",
                "note": g.get("note") or "",
            }
        )
    return rows
