# -*- coding: utf-8 -*-
"""Шаблон курсантов.

Единственное место колонок для модуля «Курсанты» и списка курсантов у теста.
Чтобы поменять шаблон — правьте CADET_COLUMNS. Обе кнопки «Скачать шаблон»
и оба загрузчика Excel читают этот список.

ФИО можно не заполнять.
"""

import io

# key — поле в разборе; header — подпись колонки в файле.
CADET_COLUMNS = [
    {
        "key": "num",
        "header": "Номер курсанта",
        "required": True,
        "width": 18,
        "sample": ("101", "102", "103"),
        "aliases": ("номер курсанта", "номер", "num", "student_num", "№", "n"),
    },
    {
        "key": "call",
        "header": "Позывной",
        "required": False,
        "width": 16,
        "sample": ("Сокол", "Ястреб", "Беркут"),
        "aliases": ("позывной", "call", "callsign"),
    },
    {
        "key": "group",
        "header": "Номер группы",
        "required": False,
        "width": 16,
        "sample": ("1", "1", "2"),
        "aliases": ("номер группы", "группа", "group", "group_num"),
    },
    {
        "key": "stream",
        "header": "Номер потока",
        "required": False,
        "width": 16,
        "sample": ("1", "1", "1"),
        "aliases": ("номер потока", "поток", "stream", "stream_num"),
    },
    {
        "key": "fio",
        "header": "ФИО",
        "required": False,
        "width": 36,
        "sample": (
            "Иванов Иван Иванович",
            "Петров Пётр Петрович",
            "Сидоров Сидор Сидорович",
        ),
        "aliases": ("фио", "full_name", "фамилия", "ф.и.о.", "ф.и.о"),
    },
]

_ALIAS_TO_KEY = {}
for _col in CADET_COLUMNS:
    for _alias in _col["aliases"]:
        _ALIAS_TO_KEY[_alias.casefold()] = _col["key"]


def _cell_str(value):
    if value is None:
        return ""
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


def build_cadets_template_bytes():
    """Один xlsx для «Курсанты» и для списка у теста."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Курсанты"
    headers = [c["header"] for c in CADET_COLUMNS]
    ws.append(headers)
    header_font = Font(bold=True, color="001014")
    fill = PatternFill("solid", fgColor="19F0F0")
    thin = Border(
        left=Side(style="thin", color="0B7F86"),
        right=Side(style="thin", color="0B7F86"),
        top=Side(style="thin", color="0B7F86"),
        bottom=Side(style="thin", color="0B7F86"),
    )
    for col, _ in enumerate(headers, 1):
        cell = ws.cell(1, col)
        cell.font = header_font
        cell.fill = fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = thin
    samples = list(zip(*(c["sample"] for c in CADET_COLUMNS)))
    for row in samples:
        ws.append(list(row))
    for idx, col in enumerate(CADET_COLUMNS, 1):
        letter = chr(ord("A") + idx - 1)
        ws.column_dimensions[letter].width = col["width"]

    ws2 = wb.create_sheet("Инструкция")
    ws2["A1"] = (
        "Шаблон курсантов. Лист «Курсанты»: "
        + ", ".join(c["header"] for c in CADET_COLUMNS)
        + "."
    )
    ws2["A2"] = (
        "Номер курсанта обязателен и уникален. Позывной, группа, поток и ФИО можно оставить пустыми."
    )
    ws2["A3"] = (
        "Этот же файл загружается в модуль «Курсанты» и в список курсантов конкретного теста."
    )
    ws2["A4"] = "Строки-примеры замените своими данными. № п/п в кабинете проставляется автоматически."
    ws2["A5"] = "Повтор номера в файле или в уже загруженном списке пропускается."
    ws2.column_dimensions["A"].width = 120
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _header_map(cells):
    mapping = {}
    hits = 0
    for idx, text in enumerate(cells):
        key = _ALIAS_TO_KEY.get(text.casefold())
        if not key or key in mapping.values():
            continue
        mapping[key] = idx
        hits += 1
    if "num" not in mapping or hits < 2:
        return None
    return mapping


def _row_by_map(cells, mapping):
    def take(key):
        idx = mapping.get(key)
        if idx is None or idx >= len(cells):
            return ""
        return cells[idx]

    return {
        "num": take("num"),
        "call": take("call"),
        "group": take("group"),
        "stream": take("stream"),
        "fio": take("fio"),
    }


def _guess_layout(cells):
    """Файлы без строки заголовков.

    4–5 колонок: номер, позывной, группа, поток, ФИО.
    3 колонки и первая — номер: номер, позывной, ФИО.
    Иначе: позывной, номер, ФИО.
    """
    a, b, c, d, e = (cells + [""] * 5)[:5]
    looks_num = bool(a) and a.replace(".", "", 1).isdigit()
    b_num = bool(b) and b.replace(".", "", 1).isdigit()
    if e or d:
        return "new5"
    if looks_num and not b_num:
        return "num_call_fio"
    return "call_num_fio"


def _row_by_layout(cells, layout):
    a, b, c, d, e = (cells + [""] * 5)[:5]
    if layout == "new5":
        return {"num": a, "call": b, "group": c, "stream": d, "fio": e}
    if layout == "call_num_fio":
        return {"num": b, "call": a, "group": "", "stream": "", "fio": c}
    return {"num": a, "call": b, "group": "", "stream": "", "fio": c}


def parse_cadets_sheet(raw: bytes):
    """(entries, duplicates). Поля: num, call, group, stream, fio.

    Номер уникален в файле: повтор попадает в duplicates, в entries его нет.
    """
    from openpyxl import load_workbook

    from . import db

    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.active
    entries = []
    duplicates = []
    seen = set()
    mapping = None
    layout = None
    header_done = False
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        cells = [_cell_str(c) for c in row[:8]]
        if not any(cells):
            continue
        if not header_done:
            header_done = True
            mapping = _header_map(cells)
            if mapping:
                continue
            layout = _guess_layout(cells)
        item = _row_by_map(cells, mapping) if mapping else _row_by_layout(cells, layout)
        num = db._norm_num(item.get("num") or "")
        if not num:
            continue
        parsed = {
            "num": num,
            "call": db._norm_call(item.get("call") or ""),
            "group": db._norm_call(item.get("group") or ""),
            "stream": db._norm_call(item.get("stream") or ""),
            "fio": db._norm_fio(item.get("fio") or ""),
        }
        if num in seen:
            duplicates.append(parsed)
            continue
        seen.add(num)
        entries.append(parsed)
    wb.close()
    return entries, duplicates
