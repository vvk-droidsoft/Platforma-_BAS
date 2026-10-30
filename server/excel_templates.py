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
    {
        "key": "phone",
        "header": "Телефон",
        "required": False,
        "width": 16,
        "sample": ("9001112233", "9001112234", ""),
        "aliases": ("телефон", "phone", "тел", "мобильный"),
    },
    {
        "key": "passport",
        "header": "Паспорт",
        "required": False,
        "width": 18,
        "sample": ("4010 123456", "4010 123457", ""),
        "aliases": ("паспорт", "passport", "серия и номер паспорта", "серия номер"),
    },
    {
        "key": "note",
        "header": "Примечание",
        "required": False,
        "width": 24,
        "sample": ("", "", ""),
        "aliases": ("примечание", "note", "комментарий"),
    },
]

# Распределение групп (оргструктура потока)
GROUP_COLUMNS = [
    {
        "key": "stream",
        "header": "Поток",
        "width": 12,
        "sample": ("36", "36", "36"),
        "aliases": ("поток", "номер потока", "stream", "stream_num"),
    },
    {
        "key": "group",
        "header": "Группа",
        "width": 12,
        "sample": ("23", "24", "25"),
        "aliases": ("группа", "номер группы", "group", "group_num"),
    },
    {
        "key": "count",
        "header": "Количество курсантов",
        "width": 14,
        "sample": ("15", "14", "16"),
        "aliases": ("количество курсантов", "количество", "кол-во", "count", "план"),
    },
    {
        "key": "instructor",
        "header": "Инструктор",
        "width": 22,
        "sample": ("Балабаев А.", "Иванов И.", "Петров П."),
        "aliases": ("инструктор", "instructor", "и"),
    },
    {
        "key": "assistants",
        "header": "Ассистенты",
        "width": 36,
        "sample": ("Ткач Е., Лукьянов С.", "Сидоров С.", ""),
        "aliases": ("ассистенты", "ассистент инструктора", "ассистент", "assistants"),
    },
    {
        "key": "classroom",
        "header": "Аудитория",
        "width": 28,
        "sample": ("104 (учебный центр)", "105", "201"),
        "aliases": ("аудитория", "classroom", "кабинет"),
    },
    {
        "key": "polygon",
        "header": "Полигон",
        "width": 20,
        "sample": ("Южный", "Южный", "Северный"),
        "aliases": ("полигон", "название полигона", "polygon"),
    },
    {
        "key": "tent",
        "header": "Палатка",
        "width": 12,
        "sample": ("5", "6", "7"),
        "aliases": ("палатка", "tent", "№ палатки"),
    },
    {
        "key": "seniors",
        "header": "Старшие потока",
        "width": 32,
        "sample": ("Малюго Д., Ветров С.", "Малюго Д., Ветров С.", "Малюго Д., Ветров С."),
        "aliases": ("старшие потока", "старший потока", "seniors", "старшие"),
    },
    {
        "key": "note",
        "header": "Примечание",
        "width": 24,
        "sample": ("", "", ""),
        "aliases": ("примечание", "note", "комментарий"),
    },
]

_ALIAS_TO_KEY = {}
for _col in CADET_COLUMNS:
    for _alias in _col["aliases"]:
        _ALIAS_TO_KEY[_alias.casefold()] = _col["key"]

_GROUP_ALIAS_TO_KEY = {}
for _col in GROUP_COLUMNS:
    for _alias in _col["aliases"]:
        _GROUP_ALIAS_TO_KEY[_alias.casefold()] = _col["key"]


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
        "Номер курсанта обязателен и уникален. Поток и группа связывают курсанта с учебной группой."
    )
    ws2["A3"] = (
        "Телефон, паспорт и примечание — по возможности. Повтор номера или того же содержимого пропускается."
    )
    ws2["A4"] = "Строки-примеры замените своими данными. № п/п в кабинете проставляется автоматически."
    ws2["A5"] = "Инструкторский состав групп загружается отдельным шаблоном «Распределение групп»."
    ws2.column_dimensions["A"].width = 120
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_groups_template_bytes():
    """Шаблон распределения групп потока."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Группы"
    headers = [c["header"] for c in GROUP_COLUMNS]
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
    samples = list(zip(*(c["sample"] for c in GROUP_COLUMNS)))
    for row in samples:
        ws.append(list(row))
    for idx, col in enumerate(GROUP_COLUMNS, 1):
        letter = chr(ord("A") + idx - 1)
        ws.column_dimensions[letter].width = col["width"]
    ws2 = wb.create_sheet("Инструкция")
    ws2["A1"] = "Шаблон распределения групп. ФИО инструкторов/ассистентов/старших — как в штатной расстановке."
    ws2["A2"] = "Несколько ассистентов или старших — через запятую. Инструктор на группу один."
    ws2["A3"] = "Повтор загрузки того же распределения обновляет пустые поля и состав, не создаёт дубли групп."
    ws2.column_dimensions["A"].width = 120
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _header_map(cells, alias_map=None, require_key="num", min_hits=2):
    alias_map = alias_map or _ALIAS_TO_KEY
    mapping = {}
    hits = 0
    for idx, text in enumerate(cells):
        key = alias_map.get(text.casefold())
        if not key or key in mapping.values():
            continue
        mapping[key] = idx
        hits += 1
    if require_key and require_key not in mapping:
        return None
    if hits < min_hits:
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
        "phone": take("phone"),
        "passport": take("passport"),
        "note": take("note"),
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
        cells = [_cell_str(c) for c in row[:12]]
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
            "phone": db._norm_call(item.get("phone") or ""),
            "passport": db._norm_call(item.get("passport") or ""),
            "note": (item.get("note") or "").strip(),
        }
        if num in seen:
            duplicates.append(parsed)
            continue
        seen.add(num)
        entries.append(parsed)
    wb.close()
    return entries, duplicates


def parse_groups_sheet(raw: bytes):
    """Строки распределения групп: stream, group, count, instructor, assistants, …"""
    from openpyxl import load_workbook

    from . import db

    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.active
    entries = []
    mapping = None
    header_done = False
    for row in ws.iter_rows(values_only=True):
        if not row:
            continue
        cells = [_cell_str(c) for c in row[:12]]
        if not any(cells):
            continue
        if not header_done:
            header_done = True
            mapping = _header_map(
                cells, alias_map=_GROUP_ALIAS_TO_KEY, require_key="stream", min_hits=2
            )
            if mapping and "group" in mapping:
                continue
            mapping = None
            # без заголовка: поток, группа, кол-во, инструктор, ассистенты, аудитория, полигон, палатка, старшие, примечание
            mapping = {
                "stream": 0,
                "group": 1,
                "count": 2,
                "instructor": 3,
                "assistants": 4,
                "classroom": 5,
                "polygon": 6,
                "tent": 7,
                "seniors": 8,
                "note": 9,
            }
            # если первая строка похожа на заголовок — пропуск уже сделан выше; иначе это данные
            if cells[0].casefold() in ("поток", "stream"):
                continue

        def take(key):
            idx = mapping.get(key)
            if idx is None or idx >= len(cells):
                return ""
            return cells[idx]

        stream = db._norm_call(take("stream"))
        group = db._norm_call(take("group"))
        if not stream or not group:
            continue
        entries.append(
            {
                "stream": stream,
                "group": group,
                "count": take("count"),
                "instructor": take("instructor"),
                "assistants": take("assistants"),
                "classroom": take("classroom"),
                "polygon": take("polygon"),
                "tent": take("tent"),
                "seniors": take("seniors"),
                "note": take("note"),
            }
        )
    wb.close()
    return entries
