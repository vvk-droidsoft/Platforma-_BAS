# -*- coding: utf-8 -*-
"""Шаблоны Excel: курсанты, группы, распределение.

Маркер типа на скрытом листе __LIS__ (B1). Без маркера импорт отклоняется.
Листы защищены паролем SHEET_PASSWORD: правка только в области данных.
"""

import io
import re
from datetime import date, datetime

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

# Документ «Распределение»: шапка потока + строка группы
DISTRIBUTION_COLUMNS = [
    {
        "key": "stream",
        "header": "Поток",
        "width": 10,
        "sample": ("34", "34", "35"),
        "aliases": ("поток", "номер потока", "stream", "stream_num"),
    },
    {
        "key": "period_from",
        "header": "Срок с",
        "width": 14,
        "sample": ("2026-10-08", "2026-10-08", "2026-11-01"),
        "aliases": (
            "срок с",
            "с",
            "дата с",
            "начало",
            "period_from",
            "from",
            "с даты",
        ),
    },
    {
        "key": "period_to",
        "header": "Срок по",
        "width": 14,
        "sample": ("2026-10-30", "2026-10-30", "2026-11-20"),
        "aliases": (
            "срок по",
            "по",
            "дата по",
            "окончание",
            "period_to",
            "to",
            "по дату",
        ),
    },
    {
        "key": "seniors",
        "header": "Старшие потока",
        "width": 36,
        "sample": (
            "Илья Иванович, Максим Николаевич",
            "Илья Иванович, Максим Николаевич",
            "Петров Пётр",
        ),
        "aliases": ("старшие потока", "старший потока", "seniors", "старшие"),
    },
    {
        "key": "polygon",
        "header": "Полигон",
        "width": 18,
        "sample": ("Головеньки", "Головеньки", "Южный"),
        "aliases": ("полигон", "название полигона", "polygon"),
    },
    {
        "key": "group",
        "header": "Группа",
        "width": 10,
        "sample": ("25", "26", "10"),
        "aliases": ("группа", "номер группы", "group", "group_num"),
    },
    {
        "key": "count",
        "header": "План курсантов",
        "width": 14,
        "sample": ("12", "14", "15"),
        "aliases": (
            "план курсантов",
            "количество курсантов",
            "количество",
            "кол-во",
            "count",
            "план",
        ),
    },
    {
        "key": "instructor",
        "header": "Инструктор",
        "width": 24,
        "sample": ("Руслан Александрович", "Сидоров С.", "Иванов И."),
        "aliases": ("инструктор", "instructor"),
    },
    {
        "key": "assistants",
        "header": "Ассистенты",
        "width": 28,
        "sample": ("Александр Владимирович", "Ткач Е.", ""),
        "aliases": ("ассистенты", "ассистент инструктора", "ассистент", "assistants"),
    },
    {
        "key": "classroom",
        "header": "Аудитория",
        "width": 16,
        "sample": ("УЦ 615", "УЦ 616", "104"),
        "aliases": ("аудитория", "classroom", "кабинет"),
    },
    {
        "key": "tent",
        "header": "Палатка",
        "width": 10,
        "sample": ("1", "2", "5"),
        "aliases": ("палатка", "tent", "№ палатки"),
    },
    {
        "key": "note",
        "header": "Примечание",
        "width": 22,
        "sample": ("", "", ""),
        "aliases": ("примечание", "note", "комментарий"),
    },
]

MARKER_SHEET = "__LIS__"
TEMPLATE_CADETS = "cadets"
TEMPLATE_GROUPS = "groups"
TEMPLATE_STAFF = "staff"
TEMPLATE_DISTRIBUTION = "distribution"
SHEET_PASSWORD = "adminbas"
DATA_UNLOCK_ROWS = 500  # строки 2..501 доступны для заполнения

TEMPLATE_LABELS = {
    TEMPLATE_CADETS: "Курсанты",
    TEMPLATE_GROUPS: "Группы",
    TEMPLATE_STAFF: "Сотрудники",
    TEMPLATE_DISTRIBUTION: "Распределение",
}

_ALIAS_TO_KEY = {}
for _col in CADET_COLUMNS:
    for _alias in _col["aliases"]:
        _ALIAS_TO_KEY[_alias.casefold()] = _col["key"]

_GROUP_ALIAS_TO_KEY = {}
for _col in GROUP_COLUMNS:
    for _alias in _col["aliases"]:
        _GROUP_ALIAS_TO_KEY[_alias.casefold()] = _col["key"]

_DIST_ALIAS_TO_KEY = {}
for _col in DISTRIBUTION_COLUMNS:
    for _alias in _col["aliases"]:
        _DIST_ALIAS_TO_KEY[_alias.casefold()] = _col["key"]


def _cell_str(value):
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


def _norm_excel_date(value: str) -> str:
    """Приводит дату к YYYY-MM-DD."""
    s = (value or "").strip()
    if not s:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})$", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    m = re.match(r"^(\d{4})[./](\d{1,2})[./](\d{1,2})$", s)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return s


def _protect_sheet(ws, password=SHEET_PASSWORD):
    ws.protection.sheet = True
    ws.protection.password = password
    ws.protection.enable()


def _unlock_data_cells(ws, n_cols, max_row=DATA_UNLOCK_ROWS):
    from openpyxl.styles import Protection

    unlocked = Protection(locked=False)
    for row in range(2, max_row + 2):
        for col in range(1, n_cols + 1):
            ws.cell(row, col).protection = unlocked


def _lock_sheet_cells(ws, max_row=40, max_col=8):
    from openpyxl.styles import Protection

    locked = Protection(locked=True)
    for row in range(1, max_row + 1):
        for col in range(1, max_col + 1):
            ws.cell(row, col).protection = locked


def add_template_marker(wb, kind: str):
    """Скрытый лист с типом шаблона + защита структуры книги."""
    from openpyxl.workbook.protection import WorkbookProtection

    kind = (kind or "").strip().casefold()
    if MARKER_SHEET in wb.sheetnames:
        del wb[MARKER_SHEET]
    ws = wb.create_sheet(MARKER_SHEET)
    ws["A1"] = "template"
    ws["B1"] = kind
    ws["A2"] = "do-not-edit"
    ws.sheet_state = "veryHidden"
    _lock_sheet_cells(ws, max_row=5, max_col=2)
    _protect_sheet(ws)
    wb.security = WorkbookProtection(
        workbookPassword=SHEET_PASSWORD,
        lockStructure=True,
        revisionsPassword=SHEET_PASSWORD,
    )


def read_template_marker(wb) -> str:
    """Возвращает cadets|groups|staff или ''."""
    if MARKER_SHEET not in wb.sheetnames:
        return ""
    ws = wb[MARKER_SHEET]
    try:
        rows = ws.iter_rows(min_row=1, max_row=5, max_col=2, values_only=True)
    except TypeError:
        rows = ws.iter_rows(min_row=1, max_row=5, max_col=2, values_only=True)
    for row in rows:
        cells = [_cell_str(c) for c in (row or ())]
        if not any(cells):
            continue
        if cells[0].casefold() == "template" and len(cells) > 1:
            return cells[1].casefold()
        if cells[0].casefold() in TEMPLATE_LABELS:
            return cells[0].casefold()
    return ""


def require_template_marker(wb, expected: str) -> None:
    """Бросает ValueError, если маркер отсутствует или не тот тип."""
    expected = (expected or "").strip().casefold()
    exp_label = TEMPLATE_LABELS.get(expected, expected)
    kind = read_template_marker(wb)
    if not kind:
        raise ValueError(
            "Файл без маркера шаблона. Скачайте актуальный шаблон «"
            + exp_label
            + "» из кабинета и заполните его — произвольные таблицы не принимаются."
        )
    if kind != expected:
        got = TEMPLATE_LABELS.get(kind, kind)
        raise ValueError(
            'Это шаблон «'
            + got
            + '». Вы загружаете его в «'
            + exp_label
            + '». Выберите правильный шаблон.'
        )


def _data_sheet(wb, preferred_titles):
    """Лист с данными: по имени, иначе первый не служебный."""
    for title in preferred_titles:
        if title in wb.sheetnames:
            return wb[title]
    for name in wb.sheetnames:
        if name in (MARKER_SHEET, "Инструкция"):
            continue
        return wb[name]
    return wb.active


def _finish_template(wb, data_ws, n_cols):
    _unlock_data_cells(data_ws, n_cols)
    _protect_sheet(data_ws)
    if "Инструкция" in wb.sheetnames:
        ins = wb["Инструкция"]
        _lock_sheet_cells(ins, max_row=20, max_col=1)
        _protect_sheet(ins)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


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
    ws2["A4"] = "Строки-примеры замените своими данными. Редактируются только ячейки таблицы данных."
    ws2["A5"] = "Загрузка принимается только из этого шаблона (не путать с шаблоном «Группы»)."
    ws2.column_dimensions["A"].width = 120
    add_template_marker(wb, TEMPLATE_CADETS)
    return _finish_template(wb, ws, len(CADET_COLUMNS))


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
    ws2["A4"] = "Редактируются только ячейки таблицы данных. Загрузка — только из этого шаблона (не путать с «Курсанты»)."
    ws2.column_dimensions["A"].width = 120
    add_template_marker(wb, TEMPLATE_GROUPS)
    return _finish_template(wb, ws, len(GROUP_COLUMNS))


def build_distribution_template_bytes():
    """Шаблон документа «Распределение»: потоки + группы."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Распределение"
    headers = [c["header"] for c in DISTRIBUTION_COLUMNS]
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
    samples = list(zip(*(c["sample"] for c in DISTRIBUTION_COLUMNS)))
    for row in samples:
        ws.append(list(row))
    for idx, col in enumerate(DISTRIBUTION_COLUMNS, 1):
        letter = chr(ord("A") + idx - 1)
        ws.column_dimensions[letter].width = col["width"]
    ws2 = wb.create_sheet("Инструкция")
    ws2["A1"] = (
        "Шаблон документа «Распределение». Одна строка = одна группа. "
        "Поля потока (сроки, старшие, полигон) одинаковы для всех групп этого потока — повторите в каждой строке."
    )
    ws2["A2"] = (
        "Колонки: "
        + ", ".join(c["header"] for c in DISTRIBUTION_COLUMNS)
        + "."
    )
    ws2["A3"] = (
        "Даты: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ. ФИО — как в штатке; несколько старших/ассистентов — через запятую."
    )
    ws2["A4"] = (
        "Загружайте в открытое распределение в кабинете. Повтор строк обновляет поток/группу, не создаёт дубли."
    )
    ws2["A5"] = "Не путать с шаблонами «Группы» и «Курсанты» — у этого файла свой маркер."
    ws2.column_dimensions["A"].width = 120
    add_template_marker(wb, TEMPLATE_DISTRIBUTION)
    return _finish_template(wb, ws, len(DISTRIBUTION_COLUMNS))


def finalize_staff_workbook(wb, data_ws, n_cols=4):
    """Маркер + защита для шаблона сотрудников (собирается в app.py)."""
    add_template_marker(wb, TEMPLATE_STAFF)
    return _finish_template(wb, data_ws, n_cols)


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


def parse_cadets_sheet(raw: bytes):
    """(entries, duplicates). Только файл с маркером template=cadets."""
    from openpyxl import load_workbook

    from . import db

    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    try:
        require_template_marker(wb, TEMPLATE_CADETS)
        ws = _data_sheet(wb, ("Курсанты",))
        entries = []
        duplicates = []
        seen = set()
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
                mapping = _header_map(cells)
                if not mapping:
                    raise ValueError(
                        "В шаблоне курсантов не найдена строка заголовков "
                        "(нужна колонка «Номер курсанта»). Скачайте шаблон заново."
                    )
                continue
            item = _row_by_map(cells, mapping)
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
        return entries, duplicates
    finally:
        wb.close()


def parse_groups_sheet(raw: bytes):
    """Строки групп. Только файл с маркером template=groups."""
    from openpyxl import load_workbook

    from . import db

    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    try:
        require_template_marker(wb, TEMPLATE_GROUPS)
        ws = _data_sheet(wb, ("Группы",))
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
                if not mapping or "group" not in mapping:
                    raise ValueError(
                        "В шаблоне групп не найдена строка заголовков "
                        "(нужны «Поток» и «Группа»). Скачайте шаблон заново."
                    )
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
        return entries
    finally:
        wb.close()


def parse_distribution_sheet(raw: bytes):
    """Строки распределения (поток+группа). Маркер template=distribution."""
    from openpyxl import load_workbook

    from . import db

    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    try:
        require_template_marker(wb, TEMPLATE_DISTRIBUTION)
        ws = _data_sheet(wb, ("Распределение",))
        entries = []
        mapping = None
        header_done = False
        for row in ws.iter_rows(values_only=True):
            if not row:
                continue
            cells = [_cell_str(c) for c in row[:16]]
            if not any(cells):
                continue
            if not header_done:
                header_done = True
                mapping = _header_map(
                    cells,
                    alias_map=_DIST_ALIAS_TO_KEY,
                    require_key="stream",
                    min_hits=2,
                )
                if not mapping or "group" not in mapping:
                    raise ValueError(
                        "В шаблоне распределения не найдена строка заголовков "
                        "(нужны «Поток» и «Группа»). Скачайте шаблон заново."
                    )
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
                    "period_from": _norm_excel_date(take("period_from")),
                    "period_to": _norm_excel_date(take("period_to")),
                    "seniors": take("seniors"),
                    "polygon": take("polygon"),
                    "count": take("count"),
                    "instructor": take("instructor"),
                    "assistants": take("assistants"),
                    "classroom": take("classroom"),
                    "tent": take("tent"),
                    "note": take("note"),
                }
            )
        return entries
    finally:
        wb.close()
