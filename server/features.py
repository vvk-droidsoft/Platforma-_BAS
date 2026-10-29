# -*- coding: utf-8 -*-
"""Реестр функциональных модулей: prod | preview | off.

prod     — доступен обычным пользователям (роль/права проверяются отдельно);
preview  — только учётки с is_tester=1 (обкатка);
off      — никому.

Чтобы выкатить модуль преподавателям: смените status на \"prod\".
"""
from __future__ import annotations

from typing import Any, Dict, Optional

STATUS_PROD = "prod"
STATUS_PREVIEW = "preview"
STATUS_OFF = "off"

# Модули, которыми управляем явно. Остальной кабинет (тесты, результаты, учётки) — prod по умолчанию.
MODULES: Dict[str, Dict[str, str]] = {
    "flight_sheet": {
        "status": STATUS_PREVIEW,
        "label": "Полётная ведомость (кабинет)",
    },
    "library": {
        "status": STATUS_PREVIEW,
        "label": "Библиотека",
    },
    "flights_tool": {
        "status": STATUS_PREVIEW,
        "label": "Полётная ведомость (инструмент)",
    },
    "polygon": {
        "status": STATUS_PREVIEW,
        "label": "Полигон",
    },
    "workload": {
        "status": STATUS_PREVIEW,
        "label": "График рабочей нагрузки",
    },
    "freq_plan": {
        "status": STATUS_PREVIEW,
        "label": "Распределение частот (палатки)",
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


def can_access(module_id: str, user: Optional[Dict[str, Any]]) -> bool:
    status = module_status(module_id)
    if status == STATUS_OFF:
        return False
    if not user:
        return False
    if status == STATUS_PROD:
        return True
    if status == STATUS_PREVIEW:
        return bool(user.get("is_tester"))
    return False


def visible_modules(user: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    return {mid: can_access(mid, user) for mid in MODULES}


def require_module(module_id: str, user: Optional[Dict[str, Any]]) -> None:
    """Бросает ValueError, если модуль недоступен (вызывающий код → HTTP 403)."""
    if not can_access(module_id, user):
        label = (MODULES.get(module_id) or {}).get("label") or module_id
        raise ValueError("Модуль недоступен: " + label)
