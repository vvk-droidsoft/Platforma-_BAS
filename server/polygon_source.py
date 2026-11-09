# -*- coding: utf-8 -*-
"""Парсер DOCX «Распределение полигонов» (формат штаба).

Структура:
- заголовок с потоком(ами) и периодом «с … по …»;
- блок «Старшие за полигон»: «Головеньки – ФИО, ФИО»;
- таблица: группа → полигон (+ организация);
- файл 38+38.1: колонки «Поток 38» / «Поток 38.1».
"""
from __future__ import annotations

import io
import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from .training import resolve_staff_by_fio, split_people

_MONTHS = {
    "января": 1,
    "февраля": 2,
    "марта": 3,
    "апреля": 4,
    "мая": 5,
    "июня": 6,
    "июля": 7,
    "августа": 8,
    "сентября": 9,
    "октября": 10,
    "ноября": 11,
    "декабря": 12,
}

_STREAMS_RE = re.compile(
    r"(?P<s>\d+(?:[.,]\d+)?)\s*(?:и\s*(?P<s2>\d+(?:[.,]\d+)?))?\s*поток",
    re.IGNORECASE,
)
# «с 30 октября по 11 ноября 2026» или «с 10 по 23 ноября 2026»
_PERIOD_RE = re.compile(
    r"с\s+(?P<d1>\d{1,2})"
    r"(?:\s+(?P<m1>[а-яё]+))?"
    r"(?:\s+(?P<y1>20\d{2})\s*г?\.?)?"
    r"\s*(?:по|—|-)\s*"
    r"(?P<d2>\d{1,2})\s+(?P<m2>[а-яё]+)"
    r"(?:\s+(?P<y2>20\d{2})\s*г?\.?)?",
    re.IGNORECASE,
)
_PERIOD_NUM_RE = re.compile(
    r"с\s*(?P<d1>\d{1,2})[./](?P<m1>\d{1,2})(?:[./](?P<y1>\d{2,4}))?"
    r"\s*(?:по|—|-)\s*"
    r"(?P<d2>\d{1,2})[./](?P<m2>\d{1,2})(?:[./](?P<y2>\d{2,4}))?",
    re.IGNORECASE,
)
_SENIOR_LINE_RE = re.compile(
    r"^\s*(?P<poly>[^–—\-:]+)\s*[–—\-:]\s*(?P<rest>.*)\s*$"
)
_STREAM_COL_RE = re.compile(
    r"поток\s*(?P<s>\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)


def _norm_stream(s: str) -> str:
    return (s or "").strip().replace(",", ".")


def _norm_group(s: str) -> str:
    t = (s or "").strip()
    if not t:
        return ""
    if re.fullmatch(r"0+\d+", t):
        t = str(int(t))
    return t


def _cell(v: Any) -> str:
    if v is None:
        return ""
    return str(v).replace("\xa0", " ").strip()


def _guess_year(filename: str = "", text: str = "") -> int:
    for src in (filename or "", text or ""):
        m = re.search(r"(20\d{2})", src)
        if m:
            return int(m.group(1))
    return date.today().year


def _ymd(y: int, m: int, d: int) -> str:
    try:
        return f"{y:04d}-{m:02d}-{d:02d}"
    except Exception:
        return ""


def _parse_period(text: str, year: int) -> Tuple[str, str]:
    t = (text or "").replace("\xa0", " ")
    m = _PERIOD_RE.search(t)
    if m:
        m2 = _MONTHS.get((m.group("m2") or "").casefold())
        m1 = _MONTHS.get((m.group("m1") or "").casefold()) or m2
        y2 = int(m.group("y2") or 0) or year
        y1 = int(m.group("y1") or 0) or y2 or year
        if m1 and m2:
            # если месяц только у конца и день начала > дня конца — месяц начала предыдущий
            d1, d2 = int(m.group("d1")), int(m.group("d2"))
            mo1, mo2 = m1, m2
            if not m.group("m1") and d1 > d2:
                mo1 = m2 - 1 if m2 > 1 else 12
                if mo1 == 12 and not m.group("y1"):
                    y1 = y2 - 1
            return (_ymd(y1, mo1, d1), _ymd(y2, mo2, d2))
    m = _PERIOD_NUM_RE.search(t)
    if m:
        y1_raw = m.group("y1")
        y2_raw = m.group("y2")
        y1 = int(y1_raw) if y1_raw else year
        if y1 < 100:
            y1 += 2000
        y2 = int(y2_raw) if y2_raw else y1
        if y2 < 100:
            y2 += 2000
        return (
            _ymd(y1, int(m.group("m1")), int(m.group("d1"))),
            _ymd(y2, int(m.group("m2")), int(m.group("d2"))),
        )
    return "", ""


def _extract_streams(text: str) -> List[str]:
    out: List[str] = []
    for m in _STREAMS_RE.finditer(text or ""):
        for key in ("s", "s2"):
            val = _norm_stream(m.group(key) or "")
            if val and val not in out:
                out.append(val)
    # «38 и 38.1 потока»
    m2 = re.search(
        r"(\d+(?:[.,]\d+)?)\s*и\s*(\d+(?:[.,]\d+)?)\s*поток",
        text or "",
        re.IGNORECASE,
    )
    if m2:
        for g in m2.groups():
            val = _norm_stream(g)
            if val and val not in out:
                out.append(val)
    return out


def _load_docx(raw: bytes):
    try:
        from docx import Document
    except ImportError as e:
        raise ValueError(
            "Для импорта DOCX нужен пакет python-docx. Обновите образ сервера."
        ) from e
    return Document(io.BytesIO(raw))


def _table_matrix(table) -> List[List[str]]:
    rows: List[List[str]] = []
    for row in table.rows:
        cells = [_cell(c.text) for c in row.cells]
        # openpyxl-like de-dupe of horizontally merged repeats
        cleaned: List[str] = []
        prev = None
        for i, v in enumerate(cells):
            if i > 0 and v == prev and v == "":
                cleaned.append("")
            else:
                cleaned.append(v)
            prev = cells[i]
        # Better: collapse consecutive identical non-empty from merge
        out: List[str] = []
        for i, v in enumerate(cells):
            if i > 0 and v and v == cells[i - 1]:
                out.append("")
            else:
                out.append(v)
        rows.append(out)
    return rows


def _header_map(cells: List[str]) -> Dict[str, Any]:
    """Возвращает индексы колонок и режим (single|by_stream)."""
    lower = [c.casefold() for c in cells]
    group_idx = None
    org_idx = None
    poly_idx = None
    stream_cols: Dict[str, int] = {}
    for i, h in enumerate(lower):
        if group_idx is None and ("групп" in h or h in ("№", "n", "num")):
            if "п/п" in h or h.startswith("№ п"):
                continue
            if "групп" in h:
                group_idx = i
                continue
        if "групп" in h and group_idx is None:
            group_idx = i
        if "организац" in h:
            org_idx = i
        m = _STREAM_COL_RE.search(h)
        if m:
            stream_cols[_norm_stream(m.group("s"))] = i
        elif "полигон" in h and poly_idx is None:
            poly_idx = i
    # fallback: col1 = group if looks numeric header-ish
    if group_idx is None and len(cells) >= 2:
        group_idx = 1
    if stream_cols:
        return {
            "mode": "by_stream",
            "group": group_idx,
            "org": org_idx,
            "stream_cols": stream_cols,
        }
    if poly_idx is None:
        # first non-group/org text column after group
        for i, h in enumerate(lower):
            if i == group_idx or i == org_idx:
                continue
            if h and "п/п" not in h and "№" != h:
                poly_idx = i
                break
    return {
        "mode": "single",
        "group": group_idx,
        "org": org_idx,
        "poly": poly_idx,
        "stream_cols": {},
    }


def parse_polygon_docx(
    raw: bytes,
    *,
    filename: str = "",
    year: Optional[int] = None,
) -> Dict[str, Any]:
    if not raw:
        raise ValueError("Пустой файл")
    doc = _load_docx(raw)
    paragraphs = [_cell(p.text) for p in doc.paragraphs if _cell(p.text)]
    title = paragraphs[0] if paragraphs else (filename or "Распределение полигонов")
    body_text = "\n".join(paragraphs)
    y = year if year else _guess_year(filename, body_text)
    streams = _extract_streams(title) or _extract_streams(body_text)
    period_from, period_to = _parse_period(title, y)
    if not period_from:
        period_from, period_to = _parse_period(body_text, y)

    # seniors block
    seniors_raw: List[Dict[str, str]] = []
    in_seniors = False
    for line in paragraphs:
        low = line.casefold()
        if "старшие за полигон" in low:
            in_seniors = True
            continue
        if in_seniors:
            if "распределен" in low and "полигон" in low:
                break
            m = _SENIOR_LINE_RE.match(line)
            if not m:
                # stop at next major section / table caption leftovers
                if re.match(r"^\d", line) or "групп" in low:
                    break
                continue
            poly = _cell(m.group("poly"))
            rest = _cell(m.group("rest"))
            if not poly:
                continue
            seniors_raw.append({"polygon": poly, "people": rest})

    rows: List[Dict[str, Any]] = []
    warnings: List[str] = []
    default_stream = streams[0] if len(streams) == 1 else ""

    for table in doc.tables:
        matrix = _table_matrix(table)
        if not matrix:
            continue
        header = matrix[0]
        hmap = _header_map(header)
        g_idx = hmap.get("group")
        if g_idx is None:
            warnings.append("В таблице не найдена колонка «Группа»")
            continue
        for raw_row in matrix[1:]:
            if g_idx >= len(raw_row):
                continue
            gnum = _norm_group(raw_row[g_idx])
            if not gnum or not re.fullmatch(r"\d{1,4}", gnum):
                continue
            org = ""
            oi = hmap.get("org")
            if oi is not None and oi < len(raw_row):
                org = raw_row[oi]
            if hmap["mode"] == "by_stream":
                for sn, ci in (hmap.get("stream_cols") or {}).items():
                    if ci >= len(raw_row):
                        continue
                    poly = raw_row[ci]
                    if not poly:
                        continue
                    rows.append(
                        {
                            "stream": sn,
                            "group": gnum,
                            "polygon": poly,
                            "organization": org,
                        }
                    )
                    if sn not in streams:
                        streams.append(sn)
            else:
                pi = hmap.get("poly")
                poly = raw_row[pi] if pi is not None and pi < len(raw_row) else ""
                if not poly:
                    warnings.append(f"Группа {gnum}: пустой полигон")
                    continue
                sn = default_stream
                if not sn and streams:
                    sn = streams[0]
                rows.append(
                    {
                        "stream": sn,
                        "group": gnum,
                        "polygon": poly,
                        "organization": org,
                    }
                )

    if not rows:
        raise ValueError("В файле не найдено строк группа→полигон")
    if not streams:
        # вывести потоки из строк
        for r in rows:
            if r["stream"] and r["stream"] not in streams:
                streams.append(r["stream"])
    # если в single-mode поток пуст — оставим пустым, apply подставит из dist
    for r in rows:
        if not r["stream"] and len(streams) == 1:
            r["stream"] = streams[0]

    seniors_resolved: List[Dict[str, Any]] = []
    unmatched_staff: List[str] = []
    seen_u = set()
    for block in seniors_raw:
        poly = block["polygon"]
        names = split_people(block.get("people") or "")
        if not names and not (block.get("people") or "").strip():
            seniors_resolved.append(
                {
                    "polygon": poly,
                    "people": [],
                    "empty": True,
                }
            )
            continue
        people = []
        for fio in names:
            st = resolve_staff_by_fio(fio)
            item = {
                "query": fio,
                "found": bool(st),
                "id": (st.get("id") if st else "") or "",
                "fio": (st.get("fio") if st else fio) or fio,
            }
            people.append(item)
            if not st:
                key = fio.casefold()
                if key not in seen_u:
                    seen_u.add(key)
                    unmatched_staff.append(fio)
        seniors_resolved.append(
            {"polygon": poly, "people": people, "empty": not people}
        )

    return {
        "ok": True,
        "title": title,
        "filename": filename or "",
        "streams": streams,
        "period_from": period_from,
        "period_to": period_to,
        "seniors": seniors_resolved,
        "rows": rows,
        "unmatched_staff": unmatched_staff,
        "warnings": warnings,
        "stats": {
            "streams": len(streams),
            "rows": len(rows),
            "polygons": len({r["polygon"] for r in rows if r.get("polygon")}),
            "seniors_blocks": len(seniors_resolved),
        },
    }
