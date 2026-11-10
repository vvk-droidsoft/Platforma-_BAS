# -*- coding: utf-8 -*-
"""Шаблоны Excel: курсанты, группы, распределение.

Маркер типа на скрытом листе __LIS__ (B1). Без маркера импорт отклоняется.
Листы защищены паролем SHEET_PASSWORD: правка только в области данных.

Примеры ФИО в шаблонах — только вымышленные:
Иванов Иван Иванович, Петров Пётр Петрович, Сидоров Сидор Сидорович
(при необходимости — другие выдуманные). Никогда не брать ФИО из данных пользователей.
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
    # Старые шаблоны: ФИО/телефон/паспорт принимаются при импорте, в новый файл не пишем
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
        "hidden_in_template": True,
    },
    {
        "key": "phone",
        "header": "Телефон",
        "required": False,
        "width": 16,
        "sample": ("9001112233", "9001112234", ""),
        "aliases": ("телефон", "phone", "тел", "мобильный"),
        "hidden_in_template": True,
    },
    {
        "key": "passport",
        "header": "Паспорт",
        "required": False,
        "width": 18,
        "sample": ("4010 123456", "4010 123457", ""),
        "aliases": ("паспорт", "passport", "серия и номер паспорта", "серия номер"),
        "hidden_in_template": True,
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
        "key": "staff",
        "header": "Состав группы",
        "width": 40,
        "sample": (
            "Иванов Иван Иванович, Петров Пётр Петрович, Сидоров Сидор Сидорович",
            "Иванов Иван Иванович, Петров Пётр Петрович",
            "Сидоров Сидор Сидорович",
        ),
        "aliases": (
            "состав группы",
            "состав",
            "сотрудники",
            "staff",
            "инструкторы и ассистенты",
        ),
    },
    # Старые шаблоны: отдельные колонки (для обратной совместимости при импорте)
    {
        "key": "instructor",
        "header": "Инструктор",
        "width": 22,
        "sample": ("", "", ""),
        "aliases": ("инструктор", "instructor", "и"),
        "hidden_in_template": True,
    },
    {
        "key": "assistants",
        "header": "Ассистенты",
        "width": 36,
        "sample": ("", "", ""),
        "aliases": ("ассистенты", "ассистент инструктора", "ассистент", "assistants"),
        "hidden_in_template": True,
    },
    {
        "key": "classroom",
        "header": "Аудитория",
        "width": 28,
        "sample": ("Ауд. 101", "Ауд. 102", "Ауд. 103"),
        "aliases": ("аудитория", "classroom", "кабинет"),
    },
    {
        "key": "polygon",
        "header": "Полигон",
        "width": 20,
        "sample": ("Северный", "Северный", "Южный"),
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
        "sample": (
            "Иванов Иван Иванович, Петров Пётр Петрович",
            "Иванов Иван Иванович, Петров Пётр Петрович",
            "Сидоров Сидор Сидорович",
        ),
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
            "Иванов Иван Иванович, Петров Пётр Петрович",
            "Иванов Иван Иванович, Петров Пётр Петрович",
            "Сидоров Сидор Сидорович",
        ),
        "aliases": ("старшие потока", "старший потока", "seniors", "старшие"),
    },
    {
        "key": "polygon",
        "header": "Полигон",
        "width": 18,
        "sample": ("Северный", "Северный", "Южный"),
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
        "sample": (
            "Иванов Иван Иванович",
            "Петров Пётр Петрович",
            "Сидоров Сидор Сидорович",
        ),
        "aliases": ("инструктор", "instructor"),
    },
    {
        "key": "assistants",
        "header": "Ассистенты",
        "width": 28,
        "sample": (
            "Петров Пётр Петрович, Сидоров Сидор Сидорович",
            "Сидоров Сидор Сидорович",
            "",
        ),
        "aliases": ("ассистенты", "ассистент инструктора", "ассистент", "assistants"),
    },
    {
        "key": "classroom",
        "header": "Аудитория",
        "width": 16,
        "sample": ("Ауд. 101", "Ауд. 102", "Ауд. 103"),
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
TEMPLATE_TENT_ASSETS = "tent_assets"
SHEET_PASSWORD = "adminbas"
DATA_UNLOCK_ROWS = 500  # строки 2..501 доступны для заполнения

TEMPLATE_LABELS = {
    TEMPLATE_CADETS: "Курсанты",
    TEMPLATE_GROUPS: "Группы",
    TEMPLATE_STAFF: "Сотрудники",
    TEMPLATE_DISTRIBUTION: "Распределение",
    TEMPLATE_TENT_ASSETS: "Имущество палатки",
}

TENT_ASSET_COLUMNS = [
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
        "sample": ("12", "12", "12"),
        "aliases": ("группа", "номер группы", "group", "group_num"),
    },
    {
        "key": "board_type",
        "header": "Тип борта",
        "width": 16,
        "sample": ("ЛИС-1.0У", "ЛИС-1.0У", "ЛИС-2.0"),
        "aliases": ("тип борта", "тип", "board_type", "бвс", "модель"),
    },
    {
        "key": "board_num",
        "header": "Бортовой номер",
        "width": 16,
        "sample": ("НН-8955", "НН-8956", "НН-9001"),
        "aliases": ("бортовой номер", "номер борта", "борт", "board_num", "серийный номер"),
    },
    {
        "key": "status",
        "header": "Статус",
        "width": 12,
        "sample": ("БГ", "БГ", "НЕ БГ"),
        "aliases": ("статус", "status", "состояние"),
    },
    {
        "key": "note",
        "header": "Примечание",
        "width": 36,
        "sample": ("", "", "Повреждение крыла при посадке"),
        "aliases": ("примечание", "note", "характер повреждений", "обстоятельства"),
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

_TENT_ASSET_ALIAS_TO_KEY = {}
for _col in TENT_ASSET_COLUMNS:
    for _alias in _col["aliases"]:
        _TENT_ASSET_ALIAS_TO_KEY[_alias.casefold()] = _col["key"]

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

    cols = [c for c in CADET_COLUMNS if not c.get("hidden_in_template")]
    wb = Workbook()
    ws = wb.active
    ws.title = "Курсанты"
    headers = [c["header"] for c in cols]
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
    samples = list(zip(*(c["sample"] for c in cols)))
    for row in samples:
        ws.append(list(row))
    for idx, col in enumerate(cols, 1):
        letter = chr(ord("A") + idx - 1)
        ws.column_dimensions[letter].width = col["width"]

    ws2 = wb.create_sheet("Инструкция")
    ws2["A1"] = (
        "Шаблон курсантов. Лист «Курсанты»: "
        + ", ".join(c["header"] for c in cols)
        + "."
    )
    ws2["A2"] = (
        "Номер курсанта обязателен и уникален. Поток и группа связывают курсанта с учебной группой."
    )
    ws2["A3"] = (
        "Примечание — по возможности. Повтор номера или того же содержимого пропускается."
    )
    ws2["A4"] = "Строки-примеры замените своими данными. Редактируются только ячейки таблицы данных."
    ws2["A5"] = "Загрузка принимается только из этого шаблона (не путать с шаблоном «Группы»)."
    ws2.column_dimensions["A"].width = 120
    add_template_marker(wb, TEMPLATE_CADETS)
    return _finish_template(wb, ws, len(cols))


def build_groups_template_bytes():
    """Шаблон групп потока: состав через запятую, роли — из штатки."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    cols = [c for c in GROUP_COLUMNS if not c.get("hidden_in_template")]
    wb = Workbook()
    ws = wb.active
    ws.title = "Группы"
    headers = [c["header"] for c in cols]
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
    samples = list(zip(*(c["sample"] for c in cols)))
    for row in samples:
        ws.append(list(row))
    for idx, col in enumerate(cols, 1):
        letter = chr(ord("A") + idx - 1)
        ws.column_dimensions[letter].width = col["width"]
    ws2 = wb.create_sheet("Инструкция")
    ws2["A1"] = (
        "Шаблон для потока. В «Состав группы» и «Старшие потока» указывайте ФИО "
        "(или фамилию и имя, или фамилию) через запятую — как в штатной расстановке."
    )
    ws2["A2"] = (
        "Должность (инструктор / ассистент) подставляется из штатки по совпадению ФИО. "
        "Несколько человек в составе — через запятую."
    )
    ws2["A3"] = (
        "Повтор загрузки того же распределения обновляет пустые поля и состав, "
        "не создаёт дубли групп."
    )
    ws2["A4"] = (
        "Редактируются только ячейки таблицы данных. Загрузка — только из этого шаблона "
        "(не путать с «Курсанты»)."
    )
    ws2.column_dimensions["A"].width = 120
    add_template_marker(wb, TEMPLATE_GROUPS)
    return _finish_template(wb, ws, len(cols))


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
            staff = take("staff")
            instructor = take("instructor")
            assistants = take("assistants")
            # Старый шаблон без «Состав группы»: склеиваем Инструктор + Ассистенты
            if not staff and (instructor or assistants):
                parts = [p for p in (instructor, assistants) if (p or "").strip()]
                staff = ", ".join(parts)
            entries.append(
                {
                    "stream": stream,
                    "group": group,
                    "count": take("count"),
                    "staff": staff,
                    "instructor": instructor,
                    "assistants": assistants,
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


def parse_distribution_passport(raw: bytes) -> dict:
    """Опциональный лист «Паспорт»: Название / Дата / Примечание."""
    from openpyxl import load_workbook

    out = {"title": "", "dist_date": "", "note": ""}
    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception:
        return out
    try:
        if "Паспорт" not in wb.sheetnames:
            return out
        ws = wb["Паспорт"]
        mapping = {
            "название": "title",
            "title": "title",
            "дата": "dist_date",
            "date": "dist_date",
            "примечание": "note",
            "note": "note",
        }
        for row in ws.iter_rows(min_row=1, max_row=20, max_col=2, values_only=True):
            if not row:
                continue
            key = _cell_str(row[0]).casefold()
            val = _cell_str(row[1] if len(row) > 1 else "")
            field = mapping.get(key)
            if not field or not val:
                continue
            if field == "dist_date":
                val = _norm_excel_date(val)
            out[field] = val
        return out
    finally:
        wb.close()


def parse_fio_corrections(raw: bytes) -> dict:
    """Лист «Не в штатке»: колонки «Исходное ФИО» → «Исправить на».

    Возвращает {нормализованный_исходный.casefold(): новое_фио} только если новое
    отличается от исходного (после trim).
    """
    from openpyxl import load_workbook

    out = {}
    try:
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except Exception:
        return out
    try:
        if "Не в штатке" not in wb.sheetnames:
            return out
        ws = wb["Не в штатке"]
        header_done = False
        col_from = 0
        col_to = 1
        for row in ws.iter_rows(values_only=True):
            if not row:
                continue
            cells = [_cell_str(c) for c in row[:6]]
            if not any(cells):
                continue
            if not header_done:
                header_done = True
                for i, h in enumerate(cells):
                    hl = h.casefold()
                    if "исходн" in hl or hl in ("фио", "fio", "было", "как в файле"):
                        col_from = i
                    if "исправ" in hl or "замен" in hl or hl in ("на", "новое", "correct"):
                        col_to = i
                continue
            src = cells[col_from] if col_from < len(cells) else ""
            dst = cells[col_to] if col_to < len(cells) else ""
            if not src or not dst:
                continue
            if src.casefold() == dst.casefold():
                continue
            out[src.casefold()] = dst
        return out
    finally:
        wb.close()


def apply_fio_corrections_to_text(text: str, corrections: dict) -> str:
    """Заменяет отдельные ФИО (через запятую) по словарю corrections."""
    from .training import split_people

    if not corrections or not (text or "").strip():
        return text or ""
    parts = split_people(text)
    changed = False
    new_parts = []
    for p in parts:
        key = p.casefold()
        if key in corrections:
            new_parts.append(corrections[key])
            changed = True
        else:
            new_parts.append(p)
    if not changed:
        return text
    return ", ".join(new_parts)


def apply_fio_corrections_to_entries(entries: list, corrections: dict) -> list:
    """Применяет правки ФИО ко всем кадровым полям строк распределения."""
    if not corrections:
        return entries
    out = []
    for e in entries:
        row = dict(e)
        for field in ("seniors", "instructor", "assistants"):
            row[field] = apply_fio_corrections_to_text(row.get(field) or "", corrections)
        out.append(row)
    return out


def build_distribution_review_bytes(report: dict) -> bytes:
    """Заполненный шаблон + подсветка ячеек + лист правок «Не в штатке».

    Подсветка состава:
    - без заливки — все ФИО в ячейке найдены;
    - жёлтая — часть найдена, часть нет;
    - красная — не найден никто из ячейки.

    Лист «Не в штатке»: колонка B «Исправить на» — при повторной загрузке
    сервер подставит эти правки во все ячейки листа «Распределение».
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side, Protection

    from .training import split_people

    passport = report.get("passport") or {}
    groups = report.get("groups") or []
    unmatched = [
        (x or "").strip()
        for x in (report.get("unmatched_staff") or [])
        if (x or "").strip()
    ]
    unmatched_cf = {x.casefold() for x in unmatched}

    def cell_miss_status(text: str) -> str:
        names = split_people(text or "")
        if not names:
            return "ok"
        miss = sum(1 for n in names if n.casefold() in unmatched_cf)
        if miss <= 0:
            return "ok"
        if miss >= len(names):
            return "all"
        return "partial"

    wb = Workbook()
    ws = wb.active
    ws.title = "Распределение"
    headers = [c["header"] for c in DISTRIBUTION_COLUMNS]
    keys = [c["key"] for c in DISTRIBUTION_COLUMNS]
    ws.append(headers)
    header_font = Font(bold=True, color="001014")
    fill = PatternFill("solid", fgColor="19F0F0")
    miss_fill = PatternFill("solid", fgColor="FF8A80")
    partial_fill = PatternFill("solid", fgColor="FFE082")
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
    for idx, col in enumerate(DISTRIBUTION_COLUMNS, 1):
        if idx <= 26:
            ws.column_dimensions[chr(ord("A") + idx - 1)].width = col["width"]

    key_cols = {k: i + 1 for i, k in enumerate(keys)}
    for g in groups:
        row_vals = []
        for k in keys:
            if k == "count":
                row_vals.append(g.get("count") or "0")
            else:
                row_vals.append(g.get(k) or "")
        ws.append(row_vals)
        r = ws.max_row
        for field in ("seniors", "instructor", "assistants"):
            col = key_cols.get(field)
            if not col:
                continue
            st = cell_miss_status(g.get(field) or "")
            if st == "all":
                ws.cell(r, col).fill = miss_fill
            elif st == "partial":
                ws.cell(r, col).fill = partial_fill

    ws_p = wb.create_sheet("Паспорт")
    ws_p["A1"] = "Название"
    ws_p["B1"] = passport.get("title") or "Распределение"
    ws_p["A2"] = "Дата"
    ws_p["B2"] = passport.get("dist_date") or ""
    ws_p["A3"] = "Примечание"
    ws_p["B3"] = passport.get("note") or ""
    ws_p["A5"] = (
        "Подсветка на «Распределение»: жёлтый — в ячейке часть ФИО не из штатки; "
        "красный — никто из ячейки не найден. "
        "Правки удобнее вносить на листе «Не в штатке» в колонке «Исправить на» — "
        "при загрузке файла они применятся ко всем вхождениям на «Распределение»."
    )
    ws_p.column_dimensions["A"].width = 16
    ws_p.column_dimensions["B"].width = 56
    ws_p.merge_cells("A5:B9")
    ws_p["A5"].alignment = Alignment(wrap_text=True, vertical="top")

    ws_e = wb.create_sheet("Не в штатке")
    ws_e.append(
        ["Исходное ФИО", "Исправить на", "Где встречается (поток / группа / поле)"]
    )
    for col in (1, 2, 3):
        ws_e.cell(1, col).font = header_font
        ws_e.cell(1, col).fill = miss_fill
    ws_e.column_dimensions["A"].width = 36
    ws_e.column_dimensions["B"].width = 36
    ws_e.column_dimensions["C"].width = 72

    where = {}
    for g in groups:
        stream = g.get("stream") or ""
        group = g.get("group") or ""
        for field, label in (
            ("seniors", "старшие"),
            ("instructor", "инструктор"),
            ("assistants", "ассистенты"),
        ):
            for name in split_people(g.get(field) or ""):
                if name.casefold() not in unmatched_cf:
                    continue
                where.setdefault(name, [])
                loc = f"поток {stream}, группа {group}, {label}"
                if loc not in where[name]:
                    where[name].append(loc)
    unlocked = Protection(locked=False)
    for name in unmatched:
        key = next((k for k in where if k.casefold() == name.casefold()), name)
        ws_e.append([name, name, "; ".join(where.get(key) or []) or "—"])
        r = ws_e.max_row
        ws_e.cell(r, 1).fill = miss_fill
        ws_e.cell(r, 2).fill = partial_fill
        ws_e.cell(r, 2).protection = unlocked

    ws_i = wb.create_sheet("Инструкция")
    ws_i["A1"] = (
        "1) Жёлтая ячейка — часть ФИО ок, часть нет; красная — никто не найден. "
        "2) На листе «Не в штатке» правьте только колонку «Исправить на» "
        "(например Тарантынов Юрий → Таратынов Юрий). "
        "3) При загрузке файла сервер заменит эти ФИО во всех ячейках «Распределение». "
        "4) Живые формулы Excel между листами для списков через запятую не используем — "
        "надёжнее правка «Исправить на» + повторная загрузка."
    )
    ws_i.column_dimensions["A"].width = 120

    add_template_marker(wb, TEMPLATE_DISTRIBUTION)
    _unlock_data_cells(ws, len(DISTRIBUTION_COLUMNS), max_row=max(50, len(groups) + 20))
    # колонка «Исправить на» всегда доступна
    for row in range(2, max(3, len(unmatched) + 5)):
        ws_e.cell(row, 2).protection = unlocked
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_tent_assets_template_bytes():
    """Шаблон имущества палатки: тип/номер борта, статус БГ|НЕ БГ."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    cols = TENT_ASSET_COLUMNS
    wb = Workbook()
    ws = wb.active
    ws.title = "Имущество"
    headers = [c["header"] for c in cols]
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
    samples = list(zip(*(c["sample"] for c in cols)))
    for row in samples:
        ws.append(list(row))
    for idx, col in enumerate(cols, 1):
        letter = chr(ord("A") + idx - 1)
        ws.column_dimensions[letter].width = col["width"]
    ws2 = wb.create_sheet("Инструкция")
    ws2["A1"] = (
        "Имущество палатки группы. При загрузке из карточки группы столбцы "
        "«Поток» и «Группа» можно оставить пустыми — подставятся сами."
    )
    ws2["A2"] = "Статус: БГ (готов) или НЕ БГ (на балансе, использовать нельзя). Списан — только через акт."
    ws2["A3"] = "Примечание — характер и обстоятельства повреждений (свободный текст)."
    ws2["A4"] = "Бортовой номер уникален в рамках одного распределения."
    ws2["A5"] = "Загрузка принимается только из этого шаблона."
    ws2.column_dimensions["A"].width = 120
    add_template_marker(wb, TEMPLATE_TENT_ASSETS)
    return _finish_template(wb, ws, len(cols))


def parse_tent_assets_sheet(raw: bytes):
    """Список строк имущества. Только marker=tent_assets."""
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    try:
        require_template_marker(wb, TEMPLATE_TENT_ASSETS)
        ws = _data_sheet(wb, ("Имущество",))
        rows = []
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
                    cells,
                    alias_map=_TENT_ASSET_ALIAS_TO_KEY,
                    require_key="board_num",
                    min_hits=2,
                )
                if not mapping or "board_type" not in mapping:
                    raise ValueError(
                        "В шаблоне имущества нужны колонки «Тип борта» и «Бортовой номер»."
                    )
                continue

            def take(key):
                idx = mapping.get(key)
                if idx is None or idx >= len(cells):
                    return ""
                return cells[idx]

            board_num = take("board_num")
            board_type = take("board_type")
            if not board_num and not board_type:
                continue
            rows.append(
                {
                    "stream": take("stream"),
                    "group": take("group"),
                    "board_type": board_type,
                    "board_num": board_num,
                    "status": take("status") or "БГ",
                    "note": take("note"),
                }
            )
        return rows
    finally:
        wb.close()
