# -*- coding: utf-8 -*-
"""Реестр функциональных модулей и персональный ACL.

Глобальный status модуля:
  prod     — доступен (с учётом персональных прав / legacy);
  preview  — обкатка: is_tester или персональный grant;
  off      — никому, кроме admin.

Персональный уровень (user_module_access):
  read  — только просмотр;
  write — чтение и редактирование.

Admin всегда write на все модули (bypass матрицы).
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

STATUS_PROD = "prod"
STATUS_PREVIEW = "preview"
STATUS_OFF = "off"

LEVEL_OFF = "off"
LEVEL_READ = "read"
LEVEL_WRITE = "write"
LEVELS = (LEVEL_READ, LEVEL_WRITE)

_LIS_ENV = (os.environ.get("LIS_ENV") or "prod").strip().lower()
IS_STAGING = _LIS_ENV in ("staging", "stage", "dev", "test")

# grantable=True — показывается в карточке учётки.
# cabinet=True — раздел кабинета преподавателя (не только /tools).
MODULES: Dict[str, Dict[str, Any]] = {
    "distributions": {
        "status": STATUS_PROD,
        "label": "Распределение",
        "grantable": True,
        "cabinet": True,
    },
    "my_groups": {
        "status": STATUS_PROD,
        "label": "Мои группы",
        "grantable": True,
        "cabinet": True,
    },
    "testing": {
        "status": STATUS_PROD,
        "label": "Тестирование",
        "grantable": True,
        "cabinet": True,
    },
    "exams": {
        "status": STATUS_PROD,
        "label": "Экзамены",
        "grantable": True,
        "cabinet": True,
    },
    "norms": {
        "status": STATUS_PROD,
        "label": "Нормативы",
        "grantable": True,
        "cabinet": True,
    },
    "flight_sheet": {
        "status": STATUS_PREVIEW,
        "label": "Полётная ведомость (кабинет)",
        "grantable": True,
        "cabinet": True,
    },
    "library": {
        "status": STATUS_PROD,
        "label": "Библиотека",
        "grantable": True,
        "cabinet": True,
    },
    "flights_tool": {
        "status": STATUS_PREVIEW,
        "label": "Полётная ведомость (инструмент)",
        "grantable": True,
        "cabinet": False,
    },
    "polygon": {
        # Старая страница /tools/polygon снята с хаба; рабочий модуль — freq_plan («Полигон»).
        "status": STATUS_OFF,
        "label": "Полигон (старый)",
        "grantable": False,
        "cabinet": False,
    },
    "workload": {
        "status": STATUS_PREVIEW,
        "label": "График рабочей нагрузки",
        "grantable": True,
        "cabinet": False,
    },
    "freq_plan": {
        # На staging (порт 8081) модуль обкатывается учёткой СИ_Тестер (is_tester).
        "status": STATUS_PREVIEW,
        "label": "Полигон",
        "grantable": True,
        "cabinet": False,
    },
}

# /tools/{name} → id модуля в реестре
TOOL_FEATURE = {
    "workload": "workload",
    "flights": "flights_tool",
    "polygon": "polygon",
}


def module_status(module_id: str) -> str:
    meta = MODULES.get(module_id)
    if not meta:
        return STATUS_PROD
    return meta.get("status") or STATUS_PROD


def grantable_modules() -> List[Dict[str, str]]:
    out = []
    for mid, meta in MODULES.items():
        if not meta.get("grantable"):
            continue
        if module_status(mid) == STATUS_OFF:
            continue
        out.append({"id": mid, "label": meta.get("label") or mid, "status": module_status(mid)})
    return out


def _norm_account_key(value: str) -> str:
    return "".join(ch for ch in (value or "").strip().casefold() if ch.isalnum())


def is_si_tester_account(user: Optional[Dict[str, Any]]) -> bool:
    """Учётка СИ_Тестер (с подчёркиванием или без)."""
    if not user:
        return False
    return _norm_account_key(str(user.get("login") or "")) == "ситестер" or _norm_account_key(
        str(user.get("display_name") or "")
    ) == "ситестер"


def _normalize_level(raw: Any) -> str:
    s = str(raw or "").strip().lower()
    if s in LEVELS:
        return s
    if s in ("1", "true", "yes", "on", "full", "edit", "rw"):
        return LEVEL_WRITE
    if s in ("view", "ro", "readonly", "read-only"):
        return LEVEL_READ
    return LEVEL_OFF


def legacy_level(module_id: str, user: Optional[Dict[str, Any]]) -> str:
    """Поведение до персональной матрицы: кабинетные prod — write; preview — через is_tester."""
    if not user:
        return LEVEL_OFF
    status = module_status(module_id)
    if status == STATUS_OFF:
        return LEVEL_OFF
    meta = MODULES.get(module_id) or {}
    if status == STATUS_PROD:
        return LEVEL_WRITE
    if status == STATUS_PREVIEW:
        if bool(user.get("is_tester") or user.get("can_flight_sheet")):
            return LEVEL_WRITE
        if IS_STAGING and module_id == "freq_plan" and is_si_tester_account(user):
            return LEVEL_WRITE
        return LEVEL_OFF
    return LEVEL_OFF


def effective_level(
    module_id: str,
    user: Optional[Dict[str, Any]],
    grants: Optional[Dict[str, str]] = None,
) -> str:
    """Итоговый уровень доступа пользователя к модулю."""
    if not user:
        return LEVEL_OFF
    status = module_status(module_id)
    if status == STATUS_OFF:
        return LEVEL_OFF
    if (user.get("role") or "") == "admin":
        return LEVEL_WRITE

    use_acl = bool(user.get("use_module_acl"))
    gmap = grants if grants is not None else (user.get("module_grants") or {})
    if use_acl:
        return _normalize_level(gmap.get(module_id))

    # ACL ещё не задавался — legacy, но персональный grant усиливает (например preview).
    personal = _normalize_level(gmap.get(module_id)) if gmap else LEVEL_OFF
    if personal in LEVELS:
        return personal
    return legacy_level(module_id, user)


def can_access(module_id: str, user: Optional[Dict[str, Any]], grants: Optional[Dict[str, str]] = None) -> bool:
    return effective_level(module_id, user, grants) in LEVELS


def can_edit(module_id: str, user: Optional[Dict[str, Any]], grants: Optional[Dict[str, str]] = None) -> bool:
    return effective_level(module_id, user, grants) == LEVEL_WRITE


def visible_modules(user: Optional[Dict[str, Any]], grants: Optional[Dict[str, str]] = None) -> Dict[str, bool]:
    return {mid: can_access(mid, user, grants) for mid in MODULES}


def module_levels(user: Optional[Dict[str, Any]], grants: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    return {mid: effective_level(mid, user, grants) for mid in MODULES}


def require_module(module_id: str, user: Optional[Dict[str, Any]]) -> None:
    """Бросает ValueError, если модуль недоступен (вызывающий код → HTTP 403)."""
    if not can_access(module_id, user):
        label = (MODULES.get(module_id) or {}).get("label") or module_id
        raise ValueError("Модуль недоступен: " + label)


def require_module_level(module_id: str, user: Optional[Dict[str, Any]], min_level: str = LEVEL_WRITE) -> None:
    """min_level: read | write."""
    need = _normalize_level(min_level) or LEVEL_WRITE
    got = effective_level(module_id, user)
    if need == LEVEL_READ and got in LEVELS:
        return
    if need == LEVEL_WRITE and got == LEVEL_WRITE:
        return
    label = (MODULES.get(module_id) or {}).get("label") or module_id
    raise ValueError("Недостаточно прав для модуля: " + label)
