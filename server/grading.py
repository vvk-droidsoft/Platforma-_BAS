# -*- coding: utf-8 -*-
"""Единая шкала оценки. Её читают сдача теста, карточка попытки и колонка «Оценка»."""

import json

DEFAULT_RULES = [
    {"min": 80, "grade": "5"},
    {"min": 70, "grade": "4"},
    {"min": 60, "grade": "3"},
    {"min": 0, "grade": "2"},
]


def normalize_rules(raw):
    """Список {min, grade}, по убыванию порога. Обязателен порог 0."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, list) or not raw:
        raise ValueError("Укажите хотя бы один порог")
    out = []
    seen = set()
    for item in raw:
        if isinstance(item, dict):
            min_raw = item.get("min")
            grade = item.get("grade")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            min_raw, grade = item[0], item[1]
        else:
            raise ValueError("Некорректная строка шкалы")
        try:
            min_pct = int(min_raw)
        except (TypeError, ValueError):
            raise ValueError("Процент должен быть целым числом от 0 до 100")
        if min_pct < 0 or min_pct > 100:
            raise ValueError("Процент должен быть от 0 до 100")
        grade = str(grade or "").strip()
        if not grade:
            raise ValueError("Укажите оценку для каждого порога")
        if min_pct in seen:
            raise ValueError("Порог " + str(min_pct) + "% указан дважды")
        seen.add(min_pct)
        out.append({"min": min_pct, "grade": grade})
    if 0 not in seen:
        raise ValueError("Добавьте порог «от 0%» — иначе низкий процент останется без оценки")
    out.sort(key=lambda r: -r["min"])
    return out


def grade_for(percent, rules=None):
    """Первая строка сверху, где процент не ниже порога."""
    rules = normalize_rules(rules if rules is not None else DEFAULT_RULES)
    try:
        pct = float(percent)
    except (TypeError, ValueError):
        pct = 0
    for rule in rules:
        if pct >= rule["min"]:
            return str(rule["grade"])
    return str(rules[-1]["grade"])
