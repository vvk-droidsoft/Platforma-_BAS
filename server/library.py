# -*- coding: utf-8 -*-
"""Библиотека кабинета СИ_Тестер: методические материалы и рабочая документация."""

import os
import re
import uuid

from . import db
from . import features


def user_can_use(user) -> bool:
    return features.can_access("library", user)

CATEGORIES = {
    "materials": "Методические материалы",
    "work": "Рабочая документация",
}

_ALLOWED_EXT = {
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".xlsm",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".zip",
    ".odt",
    ".odp",
    ".ods",
    ".txt",
    ".rtf",
}

MAX_BYTES = 40 * 1024 * 1024


def _clean_text(value: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", (value or "").replace("\u00a0", " ")).strip()
    return text[:limit]


def _extension(filename: str) -> str:
    name = os.path.basename(filename or "").strip()
    _base, ext = os.path.splitext(name)
    return ext.lower()


def save_upload(category: str, title: str, summary: str, original_name: str, raw: bytes):
    if category not in CATEGORIES:
        raise ValueError("Неизвестный раздел библиотеки")
    title = _clean_text(title, 200)
    summary = _clean_text(summary, 1000)
    if not title:
        raise ValueError("Укажите название документа")
    if not summary:
        raise ValueError("Укажите краткое описание")
    ext = _extension(original_name)
    if ext not in _ALLOWED_EXT:
        raise ValueError("Файл такого типа не подходит. Нужны PDF, Word, PowerPoint, Excel или изображение")
    if not raw:
        raise ValueError("Файл пустой")
    if len(raw) > MAX_BYTES:
        raise ValueError("Файл больше 40 МБ")
    stored = uuid.uuid4().hex + ext
    os.makedirs(db.LIBRARY_DIR, exist_ok=True)
    path = os.path.join(db.LIBRARY_DIR, stored)
    with open(path, "wb") as handle:
        handle.write(raw)
    try:
        return db.add_library_doc(category, title, summary, os.path.basename(original_name), stored)
    except Exception:
        try:
            os.remove(path)
        except OSError:
            pass
        raise


def remove_doc(doc_id: str) -> bool:
    doc = db.get_library_doc(doc_id)
    if not doc:
        return False
    stored = os.path.basename(doc.get("stored_name") or "")
    if stored:
        path = os.path.join(db.LIBRARY_DIR, stored)
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass
    return db.delete_library_doc(doc_id)


def file_path(doc: dict) -> str:
    stored = os.path.basename((doc or {}).get("stored_name") or "")
    if not stored:
        raise ValueError("Файл не найден")
    path = os.path.join(db.LIBRARY_DIR, stored)
    if not os.path.isfile(path):
        raise ValueError("Файл не найден")
    return path
