# -*- coding: utf-8 -*-
"""Имущество палатки (борты) — привязка к группе распределения."""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional

from . import db

STATUS_BG = "bg"
STATUS_NOT_BG = "not_bg"
STATUS_WRITTEN_OFF = "written_off"

STATUS_LABELS = {
    STATUS_BG: "БГ",
    STATUS_NOT_BG: "НЕ БГ",
    STATUS_WRITTEN_OFF: "Списан",
}

# Операции «можно использовать»: только БГ
USABLE_STATUSES = (STATUS_BG,)

# Переходы без акта списания
_TRANSITIONS = {
    STATUS_BG: {STATUS_NOT_BG},
    STATUS_NOT_BG: {STATUS_BG},
    STATUS_WRITTEN_OFF: set(),
}


def _norm_text(value: str, limit: int = 200) -> str:
    text = re.sub(r"\s+", " ", (value or "").replace("\u00a0", " ")).strip()
    return text[:limit]


def _norm_board_num(value: str) -> str:
    return _norm_text(value, 64).upper().replace(" ", "")


def _norm_status(value: str) -> str:
    raw = _norm_text(value, 32).casefold().replace("ё", "е")
    aliases = {
        "bg": STATUS_BG,
        "бг": STATUS_BG,
        "available": STATUS_BG,
        "not_bg": STATUS_NOT_BG,
        "не бг": STATUS_NOT_BG,
        "небг": STATUS_NOT_BG,
        "written_off": STATUS_WRITTEN_OFF,
        "списан": STATUS_WRITTEN_OFF,
        "списание": STATUS_WRITTEN_OFF,
    }
    return aliases.get(raw, "")


def status_label(code: str) -> str:
    return STATUS_LABELS.get(code, code or "—")


def _asset_out(row) -> Dict[str, Any]:
    d = dict(row)
    d["status_label"] = status_label(d.get("status") or "")
    d["usable"] = (d.get("status") or "") in USABLE_STATUSES
    return d


def get_group(group_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT id, distribution_id, stream_num, group_num, tent_num, polygon_name
            FROM distribution_groups WHERE id=?
            """,
            (group_id,),
        ).fetchone()
    return dict(row) if row else None


def user_on_group_staff(user: dict, group_id: str) -> bool:
    staff_id = (user or {}).get("staff_id") or ""
    if not staff_id or not group_id:
        return False
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM distribution_group_staff
            WHERE group_id=? AND staff_id=? AND role IN ('instructor', 'assistant')
            LIMIT 1
            """,
            (group_id, staff_id),
        ).fetchone()
    return bool(row)


def user_can_view_assets(user: dict, group_id: str) -> bool:
    role = (user or {}).get("role") or ""
    if role in ("admin", "senior"):
        return True
    return user_on_group_staff(user, group_id)


def user_can_manage_assets(user: dict, group_id: str) -> bool:
    return user_can_view_assets(user, group_id)


def list_assets(
    group_id: str,
    *,
    usable_only: bool = False,
    include_written_off: bool = True,
) -> List[Dict[str, Any]]:
    clauses = ["distribution_group_id=?"]
    params: List[Any] = [group_id]
    if usable_only:
        clauses.append("status=?")
        params.append(STATUS_BG)
    elif not include_written_off:
        clauses.append("status<>?")
        params.append(STATUS_WRITTEN_OFF)
    sql = (
        "SELECT * FROM tent_assets WHERE "
        + " AND ".join(clauses)
        + " ORDER BY board_type, board_num"
    )
    with db.connect() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_asset_out(r) for r in rows]


def get_asset(asset_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM tent_assets WHERE id=?", (asset_id,)
        ).fetchone()
    return _asset_out(row) if row else None


def _add_event(
    conn,
    asset_id: str,
    from_status: str,
    to_status: str,
    note: str,
    created_by: str,
) -> None:
    conn.execute(
        """
        INSERT INTO tent_asset_events(
          id, asset_id, from_status, to_status, note, created_at, created_by
        ) VALUES(?,?,?,?,?,?,?)
        """,
        (
            uuid.uuid4().hex,
            asset_id,
            from_status or "",
            to_status or "",
            _norm_text(note, 1000),
            db._now(),
            created_by or "",
        ),
    )


def add_asset(
    group_id: str,
    *,
    board_type: str,
    board_num: str,
    status: str = STATUS_BG,
    note: str = "",
    created_by: str = "",
) -> Dict[str, Any]:
    group = get_group(group_id)
    if not group:
        raise ValueError("Группа не найдена")
    btype = _norm_text(board_type, 80)
    bnum = _norm_board_num(board_num)
    st = _norm_status(status) or STATUS_BG
    if st == STATUS_WRITTEN_OFF:
        raise ValueError("Статус «Списан» ставится только через акт списания")
    if st not in (STATUS_BG, STATUS_NOT_BG):
        raise ValueError("Неизвестный статус. Допустимо: БГ, НЕ БГ")
    if not btype:
        raise ValueError("Укажите тип борта")
    if not bnum:
        raise ValueError("Укажите бортовой номер")
    aid = uuid.uuid4().hex
    now = db._now()
    with db.connect() as conn:
        exists = conn.execute(
            """
            SELECT id FROM tent_assets
            WHERE distribution_id=? AND board_num=?
            """,
            (group["distribution_id"], bnum),
        ).fetchone()
        if exists:
            raise ValueError("Борт с номером " + bnum + " уже есть в этом распределении")
        conn.execute(
            """
            INSERT INTO tent_assets(
              id, distribution_id, distribution_group_id, board_type, board_num,
              status, note, written_off_at, written_off_by,
              status_changed_at, status_changed_by, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                aid,
                group["distribution_id"],
                group_id,
                btype,
                bnum,
                st,
                _norm_text(note, 1000),
                "",
                "",
                now,
                created_by or "",
                now,
            ),
        )
        _add_event(conn, aid, "", st, note, created_by)
    return get_asset(aid)


def set_status(
    asset_id: str,
    to_status: str,
    *,
    note: str = "",
    changed_by: str = "",
) -> Dict[str, Any]:
    asset = get_asset(asset_id)
    if not asset:
        raise ValueError("Борт не найден")
    target = _norm_status(to_status)
    if not target:
        raise ValueError("Неизвестный статус")
    if target == STATUS_WRITTEN_OFF:
        raise ValueError("Списание только через акт «Списать утерянный борт»")
    current = asset.get("status") or ""
    if current == STATUS_WRITTEN_OFF:
        raise ValueError("Списанный борт нельзя менять")
    if target == current:
        # обновить примечание
        with db.connect() as conn:
            conn.execute(
                "UPDATE tent_assets SET note=? WHERE id=?",
                (_norm_text(note, 1000) if note else asset.get("note") or "", asset_id),
            )
        return get_asset(asset_id)
    allowed = _TRANSITIONS.get(current) or set()
    if target not in allowed:
        raise ValueError(
            "Нельзя сменить статус «"
            + status_label(current)
            + "» → «"
            + status_label(target)
            + "»"
        )
    now = db._now()
    new_note = _norm_text(note, 1000) if note else (asset.get("note") or "")
    with db.connect() as conn:
        conn.execute(
            """
            UPDATE tent_assets
            SET status=?, note=?, status_changed_at=?, status_changed_by=?
            WHERE id=?
            """,
            (target, new_note, now, changed_by or "", asset_id),
        )
        _add_event(conn, asset_id, current, target, new_note, changed_by)
    return get_asset(asset_id)


def mark_written_off(
    asset_id: str,
    *,
    note: str = "",
    changed_by: str = "",
) -> Dict[str, Any]:
    """Списание утери: только из статуса БГ."""
    asset = get_asset(asset_id)
    if not asset:
        raise ValueError("Борт не найден")
    if asset.get("status") != STATUS_BG:
        raise ValueError("Списать можно только борт со статусом БГ")
    now = db._now()
    new_note = _norm_text(note, 1000) if note else (asset.get("note") or "")
    with db.connect() as conn:
        conn.execute(
            """
            UPDATE tent_assets
            SET status=?, note=?, written_off_at=?, written_off_by=?,
                status_changed_at=?, status_changed_by=?
            WHERE id=?
            """,
            (
                STATUS_WRITTEN_OFF,
                new_note,
                now,
                changed_by or "",
                now,
                changed_by or "",
                asset_id,
            ),
        )
        _add_event(
            conn, asset_id, STATUS_BG, STATUS_WRITTEN_OFF, new_note, changed_by
        )
    return get_asset(asset_id)


def delete_asset(asset_id: str) -> bool:
    asset = get_asset(asset_id)
    if not asset:
        return False
    if asset.get("status") == STATUS_WRITTEN_OFF:
        raise ValueError("Списанный борт нельзя удалить")
    with db.connect() as conn:
        conn.execute("DELETE FROM tent_asset_events WHERE asset_id=?", (asset_id,))
        cur = conn.execute("DELETE FROM tent_assets WHERE id=?", (asset_id,))
    return cur.rowcount > 0


def import_rows(
    group_id: str,
    rows: List[Dict[str, Any]],
    *,
    created_by: str = "",
) -> Dict[str, Any]:
    """Импорт строк в конкретную группу. Поток/группа в файле — сверка при наличии."""
    group = get_group(group_id)
    if not group:
        raise ValueError("Группа не найдена")
    added = 0
    skipped = 0
    errors: List[str] = []
    for i, raw in enumerate(rows, start=2):
        stream = _norm_text(str(raw.get("stream") or ""), 32)
        gnum = _norm_text(str(raw.get("group") or ""), 32)
        if stream and stream != _norm_text(str(group.get("stream_num") or ""), 32):
            errors.append("Строка " + str(i) + ": поток не совпадает с группой")
            continue
        if gnum and gnum != _norm_text(str(group.get("group_num") or ""), 32):
            errors.append("Строка " + str(i) + ": группа не совпадает")
            continue
        try:
            add_asset(
                group_id,
                board_type=str(raw.get("board_type") or ""),
                board_num=str(raw.get("board_num") or ""),
                status=str(raw.get("status") or STATUS_BG),
                note=str(raw.get("note") or ""),
                created_by=created_by,
            )
            added += 1
        except ValueError as e:
            msg = str(e)
            if "уже есть" in msg:
                skipped += 1
            else:
                errors.append("Строка " + str(i) + ": " + msg)
    return {
        "ok": True,
        "added": added,
        "skipped": skipped,
        "errors": errors,
        "assets": list_assets(group_id),
    }


def group_staff_for_writeoff(group_id: str) -> List[Dict[str, Any]]:
    """Инструктор и ассистенты группы для формы списания."""
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT s.id, s.fio, s.role AS staff_role, dgs.role AS group_role
            FROM distribution_group_staff dgs
            JOIN staff s ON s.id=dgs.staff_id
            WHERE dgs.group_id=? AND dgs.role IN ('instructor', 'assistant')
            ORDER BY CASE dgs.role WHEN 'instructor' THEN 0 ELSE 1 END, s.fio
            """,
            (group_id,),
        ).fetchall()
    out = []
    for r in rows:
        role = r["group_role"]
        out.append(
            {
                "id": r["id"],
                "fio": r["fio"] or "",
                "group_role": role,
                "role_label": (
                    "Инструктор" if role == "instructor" else "Ассистент инструктора"
                ),
            }
        )
    return out
