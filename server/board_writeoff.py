# -*- coding: utf-8 -*-
"""Акт списания утерянного борта (служебная записка Word)."""
from __future__ import annotations

import io
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from docx import Document

TEMPLATE_PATH = os.path.join(
    os.path.dirname(__file__), "templates", "acts", "writeoff_lost_board.docx"
)

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

# Именительный → родительный для распространённых имён/отчеств
_NAME_GENITIVE = {
    "александр": "Александра",
    "алексей": "Алексея",
    "андрей": "Андрея",
    "антон": "Антона",
    "артём": "Артёма",
    "артем": "Артема",
    "борис": "Бориса",
    "вадим": "Вадима",
    "валентин": "Валентина",
    "валерий": "Валерия",
    "василий": "Василия",
    "виктор": "Виктора",
    "виталий": "Виталия",
    "владимир": "Владимира",
    "владислав": "Владислава",
    "вячеслав": "Вячеслава",
    "геннадий": "Геннадия",
    "георгий": "Георгия",
    "григорий": "Григория",
    "данил": "Данила",
    "даниил": "Даниила",
    "денис": "Дениса",
    "дмитрий": "Дмитрия",
    "евгений": "Евгения",
    "егор": "Егора",
    "иван": "Ивана",
    "игорь": "Игоря",
    "илья": "Ильи",
    "кирилл": "Кирилла",
    "константин": "Константина",
    "лев": "Льва",
    "леонид": "Леонида",
    "максим": "Максима",
    "михаил": "Михаила",
    "никита": "Никиты",
    "николай": "Николая",
    "олег": "Олега",
    "павел": "Павла",
    "пётр": "Петра",
    "петр": "Петра",
    "роман": "Романа",
    "руслан": "Руслана",
    "сергей": "Сергея",
    "станислав": "Станислава",
    "степан": "Степана",
    "тимофей": "Тимофея",
    "фёдор": "Фёдора",
    "федор": "Федора",
    "юрий": "Юрия",
    "ярослав": "Ярослава",
}


def _norm(value: str, limit: int = 200) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u00a0", " ")).strip()[:limit]


def parse_event_dt(date_s: str, time_s: str) -> datetime:
    """Дата ДД.ММ.ГГГГ или ГГГГ-ММ-ДД + время ЧЧ:ММ."""
    date_s = _norm(date_s, 32)
    time_s = _norm(time_s, 16)
    if not date_s:
        raise ValueError("Укажите дату происшествия")
    if not time_s:
        raise ValueError("Укажите время происшествия")
    dt = None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            d = datetime.strptime(date_s, fmt)
            dt = d
            break
        except ValueError:
            continue
    if dt is None:
        raise ValueError("Дата происшествия: ДД.ММ.ГГГГ")
    tm = None
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            tm = datetime.strptime(time_s, fmt)
            break
        except ValueError:
            continue
    if tm is None:
        raise ValueError("Время происшествия: ЧЧ:ММ")
    return datetime(dt.year, dt.month, dt.day, tm.hour, tm.minute)


def parse_sign_date(date_s: str) -> datetime:
    date_s = _norm(date_s, 32)
    if not date_s:
        raise ValueError("Укажите дату написания")
    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_s, fmt)
        except ValueError:
            continue
    raise ValueError("Дата написания: ДД.ММ.ГГГГ")


def format_date_dotted(dt: datetime) -> str:
    return dt.strftime("%d.%m.%Y")


def format_time_hm(dt: datetime) -> str:
    return dt.strftime("%H:%M")


def format_sign_date_ru(dt: datetime) -> str:
    return f"{dt.day} {_MONTHS_RU[dt.month]} {dt.year} г."


def short_fio(fio: str) -> str:
    """Иванов Иван Петрович → Иванов И.П."""
    parts = [p for p in _norm(fio, 200).split(" ") if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    initials = "".join((p[0] + ".") for p in parts[1:] if p)
    return (parts[0] + " " + initials).strip()


def _surname_genitive(surname: str) -> str:
    s = surname
    low = s.casefold().replace("ё", "е")
    if low.endswith(("ова", "ева", "ина", "ына", "ая", "яя")):
        return s  # уже похоже на женский родительный / женскую фамилию
    if low.endswith(("ский", "цкий")):
        return s[:-2] + "ого"
    if low.endswith(("ской", "цкой")):
        return s[:-2] + "ого"
    if low.endswith(("ый", "ий")):
        return s[:-2] + "ого"
    if low.endswith(("ов", "ев", "ёв", "ин", "ын")):
        return s + "а"
    if low.endswith("а"):
        return s[:-1] + "ой"
    if low.endswith("я"):
        return s[:-1] + "и"
    return s + "а"


def _given_genitive(name: str) -> str:
    key = name.casefold().replace("ё", "е")
    mapped = _NAME_GENITIVE.get(key)
    if mapped:
        # сохранить регистр первой буквы как в исходном
        if name[:1].isupper():
            return mapped[0].upper() + mapped[1:]
        return mapped
    low = key
    if low.endswith(("ий", "ый")):
        return name[:-2] + "ого"
    if low.endswith("ей"):
        return name[:-2] + "ея"
    if low.endswith("ай"):
        return name[:-2] + "ая"
    if low.endswith("ь"):
        return name[:-1] + "я"
    if low.endswith("а"):
        return name[:-1] + "ы"
    if low.endswith("я"):
        return name[:-1] + "и"
    if low.endswith(("о", "у", "е", "и", "ы")):
        return name
    return name + "а"


def fio_genitive(fio: str) -> str:
    """Грубая форма родительного падежа ФИО для шапки «от …»."""
    parts = [p for p in _norm(fio, 200).split(" ") if p]
    if not parts:
        return ""
    out = [_surname_genitive(parts[0])]
    for p in parts[1:]:
        out.append(_given_genitive(p))
    return " ".join(out)


def default_event_and_sign(
    now: Optional[datetime] = None,
) -> Tuple[datetime, datetime]:
    """Событие = сейчас − 30 мин; дата написания = сегодня."""
    now = now or datetime.now()
    event = now - timedelta(minutes=30)
    sign = datetime(now.year, now.month, now.day)
    return event, sign


def _replace_placeholders_in_paragraph(paragraph, mapping: Dict[str, str]) -> None:
    text = paragraph.text or ""
    if not text or "{{" not in text:
        return
    new = text
    for key, val in mapping.items():
        new = new.replace("{{" + key + "}}", val)
    if new == text:
        return
    if paragraph.runs:
        paragraph.runs[0].text = new
        for r in paragraph.runs[1:]:
            r.text = ""
    else:
        paragraph.add_run(new)


def fill_writeoff_docx(mapping: Dict[str, str]) -> bytes:
    if not os.path.isfile(TEMPLATE_PATH):
        raise FileNotFoundError("Не найден шаблон акта списания")
    doc = Document(TEMPLATE_PATH)
    for p in doc.paragraphs:
        _replace_placeholders_in_paragraph(p, mapping)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    _replace_placeholders_in_paragraph(p, mapping)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def build_writeoff_docx(
    *,
    polygon: str,
    board_type: str,
    board_num: str,
    coords: str,
    fio: str,
    role_label: str,
    event_dt: datetime,
    sign_dt: datetime,
    fio_gen: str = "",
) -> bytes:
    mapping = {
        "event_date": format_date_dotted(event_dt),
        "event_time": format_time_hm(event_dt),
        "polygon": _norm(polygon, 120) or "—",
        "board_type": _norm(board_type, 80),
        "board_num": _norm(board_num, 64),
        "coords": _norm(coords, 120),
        "sign_date": format_sign_date_ru(sign_dt),
        "sign_short": short_fio(fio),
        "fio_genitive": _norm(fio_gen, 200) or fio_genitive(fio),
        "role_label": _norm(role_label, 80),
    }
    if not mapping["board_type"]:
        raise ValueError("Не указан тип борта")
    if not mapping["board_num"]:
        raise ValueError("Не указан бортовой номер")
    if not mapping["coords"]:
        raise ValueError("Укажите координаты")
    if not _norm(fio, 200):
        raise ValueError("Укажите ФИО")
    if not mapping["role_label"]:
        raise ValueError("Укажите должность")
    return fill_writeoff_docx(mapping)


def suggest_filename(board_num: str, event_dt: datetime) -> str:
    """Только ASCII: кириллица в filename ломает latin-1 заголовки Starlette."""
    raw = _norm(board_num, 64)
    # оставить латиницу/цифры/точку/дефис; остальное → _
    num = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._-")
    if not num:
        num = "board"
    return f"poterya_borta_{num}_{event_dt.strftime('%Y%m%d')}.docx"


def validate_coords(coords: str) -> str:
    text = _norm(coords, 120)
    if not text:
        raise ValueError("Укажите координаты")
    # допускаем «54.87, 37.24» / «54,87 37,24» / с °
    if len(text) < 5:
        raise ValueError("Координаты слишком короткие")
    return text


def payload_preview(data: Dict[str, Any]) -> Dict[str, Any]:
    """Для отладки/ответов API без файла."""
    return {k: data.get(k) for k in (
        "asset_id", "board_type", "board_num", "polygon", "coords",
        "fio", "role_label", "event_date", "event_time", "sign_date",
    )}
