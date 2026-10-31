# -*- coding: utf-8 -*-
"""Мои группы: рабочая копия строк распределения для инструктора/ассистента."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Tuple

from . import db
from . import distributions


def _owner_key(user: Dict[str, Any]) -> Tuple[str, str]:
    staff_id = (user.get("staff_id") or "").strip()
    user_id = (user.get("id") or "").strip()
    return staff_id, user_id


def _load_cadets(conn, my_group_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM my_group_cadets
        WHERE my_group_id=?
        ORDER BY npp ASC, rowid ASC
        """,
        (my_group_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _ensure_cadet_slots(conn, my_group_id: str, planned: int) -> None:
    planned = max(0, min(int(planned or 0), 120))
    existing = conn.execute(
        "SELECT COUNT(*) AS c FROM my_group_cadets WHERE my_group_id=?",
        (my_group_id,),
    ).fetchone()
    have = int(existing["c"] or 0)
    if have < planned:
        for i in range(have + 1, planned + 1):
            conn.execute(
                """
                INSERT INTO my_group_cadets(
                  id, my_group_id, npp, num, callsign, fio, phone, passport, note
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (uuid.uuid4().hex, my_group_id, i, "", "", "", "", "", ""),
            )
    elif have > planned and planned >= 0:
        # лишние пустые строки с конца убираем; заполненные не трогаем сверх плана —
        # оставляем все заполненные + обрезаем только полностью пустые хвосты
        rows = conn.execute(
            """
            SELECT id, npp, num, callsign, fio, phone, passport, note
            FROM my_group_cadets WHERE my_group_id=?
            ORDER BY npp DESC
            """,
            (my_group_id,),
        ).fetchall()
        keep = planned
        for r in rows:
            filled = any(
                (r[k] or "").strip()
                for k in ("num", "callsign", "fio", "phone", "passport", "note")
            )
            if not filled and keep < have:
                conn.execute("DELETE FROM my_group_cadets WHERE id=?", (r["id"],))
                have -= 1
            if have <= keep:
                break
        # перенумерация
        left = conn.execute(
            """
            SELECT id FROM my_group_cadets WHERE my_group_id=?
            ORDER BY npp ASC, rowid ASC
            """,
            (my_group_id,),
        ).fetchall()
        for i, row in enumerate(left, 1):
            conn.execute(
                "UPDATE my_group_cadets SET npp=? WHERE id=?", (i, row["id"])
            )


def get_my_group(my_group_id: str, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    staff_id, user_id = _owner_key(user)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM my_groups WHERE id=?", (my_group_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        if staff_id and d.get("owner_staff_id") == staff_id:
            pass
        elif user_id and d.get("owner_user_id") == user_id:
            pass
        elif user.get("role") == "admin":
            pass
        else:
            return None
        d["cadets"] = _load_cadets(conn, my_group_id)
    return d


def list_my_groups(user: Dict[str, Any]) -> List[Dict[str, Any]]:
    staff_id, user_id = _owner_key(user)
    with db.connect() as conn:
        if user.get("role") == "admin" and not staff_id:
            rows = conn.execute(
                "SELECT * FROM my_groups ORDER BY created_at DESC"
            ).fetchall()
        elif staff_id:
            rows = conn.execute(
                """
                SELECT * FROM my_groups
                WHERE owner_staff_id=?
                ORDER BY created_at DESC
                """,
                (staff_id,),
            ).fetchall()
        elif user_id:
            rows = conn.execute(
                """
                SELECT * FROM my_groups
                WHERE owner_user_id=?
                ORDER BY created_at DESC
                """,
                (user_id,),
            ).fetchall()
        else:
            return []
        out = []
        for r in rows:
            d = dict(r)
            d["cadets"] = _load_cadets(conn, d["id"])
            d["cadets_filled"] = sum(
                1
                for c in d["cadets"]
                if any(
                    (c.get(k) or "").strip()
                    for k in ("num", "callsign", "fio", "phone")
                )
            )
            out.append(d)
    return out


def my_group_ids_for_staff(staff_id: str) -> set:
    if not staff_id:
        return set()
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT distribution_group_id FROM my_groups
            WHERE owner_staff_id=? AND trim(distribution_group_id)<>''
            """,
            (staff_id,),
        ).fetchall()
    return {r["distribution_group_id"] for r in rows}


def add_from_distribution_group(
    user: Dict[str, Any], dist_id: str, group_row_id: str
) -> Dict[str, Any]:
    staff_id, user_id = _owner_key(user)
    if not staff_id and user.get("role") != "admin":
        raise ValueError("Учётка не связана со штаткой — нельзя добавить группу")
    dist = distributions.get_distribution(dist_id)
    if not dist:
        raise ValueError("Распределение не найдено")
    group = None
    stream = None
    for s in dist.get("streams") or []:
        for g in s.get("groups") or []:
            if g.get("id") == group_row_id:
                group = g
                stream = s
                break
        if group:
            break
    if not group:
        raise ValueError("Группа не найдена в распределении")

    my_role = ""
    if staff_id:
        for p in group.get("instructors") or []:
            if p.get("id") == staff_id:
                my_role = "instructor"
                break
        if not my_role:
            for p in group.get("assistants") or []:
                if p.get("id") == staff_id:
                    my_role = "assistant"
                    break
        if not my_role and user.get("role") != "admin":
            raise ValueError("Вы не закреплены за этой группой в распределении")
    elif user.get("role") == "admin":
        my_role = "admin"

    mid = uuid.uuid4().hex
    planned = int(group.get("planned_count") or 0)
    owner_staff = staff_id or ("admin:" + (user_id or "x"))
    with db.connect() as conn:
        exists = conn.execute(
            """
            SELECT id FROM my_groups
            WHERE owner_staff_id=? AND distribution_group_id=?
            """,
            (owner_staff, group_row_id),
        ).fetchone()
        if exists:
            raise ValueError("Эта группа уже есть в «Мои группы»")
        conn.execute(
            """
            INSERT INTO my_groups(
              id, owner_staff_id, owner_user_id, distribution_id, distribution_group_id,
              dist_title, stream_num, group_num, period_from, period_to, polygon_name,
              planned_count, classroom, tent_num, note, my_role, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                mid,
                owner_staff,
                user_id,
                dist_id,
                group_row_id,
                dist.get("title") or "",
                (stream or {}).get("stream_num") or group.get("stream_num") or "",
                group.get("group_num") or "",
                (stream or {}).get("period_from") or group.get("period_from") or "",
                (stream or {}).get("period_to") or group.get("period_to") or "",
                (stream or {}).get("polygon_name") or group.get("polygon_name") or "",
                planned,
                group.get("classroom") or "",
                group.get("tent_num") or "",
                group.get("note") or "",
                my_role,
                db._now(),
            ),
        )
        _ensure_cadet_slots(conn, mid, planned)
    row = get_my_group(mid, user)
    if not row:
        raise ValueError("Не удалось создать группу")
    return row


def add_all_mine_from_distribution(
    user: Dict[str, Any], dist_id: str
) -> Dict[str, Any]:
    staff_id, _ = _owner_key(user)
    if not staff_id:
        raise ValueError("Учётка не связана со штаткой")
    dist = distributions.get_distribution(dist_id)
    if not dist:
        raise ValueError("Распределение не найдено")
    added = []
    skipped = []
    for s in dist.get("streams") or []:
        for g in s.get("groups") or []:
            ids = {
                p["id"]
                for p in (g.get("instructors") or []) + (g.get("assistants") or [])
            }
            if staff_id not in ids:
                continue
            try:
                row = add_from_distribution_group(user, dist_id, g["id"])
                added.append(row)
            except ValueError as e:
                skipped.append(
                    {
                        "group_id": g["id"],
                        "stream": g.get("stream_num") or s.get("stream_num"),
                        "group": g.get("group_num"),
                        "reason": str(e),
                    }
                )
    return {"added": added, "skipped": skipped, "added_count": len(added)}


def update_my_group_meta(
    my_group_id: str,
    user: Dict[str, Any],
    *,
    classroom: Optional[str] = None,
    tent_num: Optional[str] = None,
    note: Optional[str] = None,
    planned_count: Optional[int] = None,
) -> Dict[str, Any]:
    cur = get_my_group(my_group_id, user)
    if not cur:
        raise ValueError("Группа не найдена")
    with db.connect() as conn:
        if classroom is not None:
            conn.execute(
                "UPDATE my_groups SET classroom=? WHERE id=?",
                ((classroom or "").strip(), my_group_id),
            )
        if tent_num is not None:
            conn.execute(
                "UPDATE my_groups SET tent_num=? WHERE id=?",
                ((tent_num or "").strip(), my_group_id),
            )
        if note is not None:
            conn.execute(
                "UPDATE my_groups SET note=? WHERE id=?",
                ((note or "").strip(), my_group_id),
            )
        if planned_count is not None:
            pc = max(0, min(int(planned_count), 120))
            conn.execute(
                "UPDATE my_groups SET planned_count=? WHERE id=?",
                (pc, my_group_id),
            )
            _ensure_cadet_slots(conn, my_group_id, pc)
    row = get_my_group(my_group_id, user)
    if not row:
        raise ValueError("Группа не найдена")
    return row


def save_my_group_cadets(
    my_group_id: str, user: Dict[str, Any], cadets: List[Dict[str, Any]]
) -> Dict[str, Any]:
    cur = get_my_group(my_group_id, user)
    if not cur:
        raise ValueError("Группа не найдена")
    with db.connect() as conn:
        conn.execute(
            "DELETE FROM my_group_cadets WHERE my_group_id=?", (my_group_id,)
        )
        for i, c in enumerate(cadets or [], 1):
            if i > 120:
                break
            conn.execute(
                """
                INSERT INTO my_group_cadets(
                  id, my_group_id, npp, num, callsign, fio, phone, passport, note
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    uuid.uuid4().hex,
                    my_group_id,
                    i,
                    db._norm_call(c.get("num") or ""),
                    db._norm_call(c.get("callsign") or c.get("call") or ""),
                    db._norm_fio(c.get("fio") or ""),
                    db._norm_call(c.get("phone") or ""),
                    db._norm_call(c.get("passport") or ""),
                    (c.get("note") or "").strip(),
                ),
            )
        # если строк меньше плана — добить пустыми
        planned = int(cur.get("planned_count") or 0)
        _ensure_cadet_slots(conn, my_group_id, planned)
    row = get_my_group(my_group_id, user)
    if not row:
        raise ValueError("Группа не найдена")
    return row


def delete_my_group(my_group_id: str, user: Dict[str, Any]) -> None:
    cur = get_my_group(my_group_id, user)
    if not cur:
        raise ValueError("Группа не найдена")
    with db.connect() as conn:
        conn.execute(
            "DELETE FROM my_group_cadets WHERE my_group_id=?", (my_group_id,)
        )
        conn.execute("DELETE FROM my_groups WHERE id=?", (my_group_id,))
