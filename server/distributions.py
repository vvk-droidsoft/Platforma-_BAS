# -*- coding: utf-8 -*-
"""Учебные распределения: документ → строки групп по потокам."""
from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional

from . import auth
from . import db


def _staff_brief(staff_id: str, cache: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if staff_id in cache:
        return cache[staff_id]
    s = auth.get_staff(staff_id)
    if not s:
        cache[staff_id] = None
        return None
    role = s.get("role") or ""
    brief = {
        "id": s["id"],
        "fio": s.get("fio") or "",
        "role": role,
        "role_label": auth.ROLE_LABELS.get(role, role),
        "callsign": s.get("callsign") or "",
        "department_id": s.get("department_id") or "",
        "department_name": s.get("department_name") or "",
    }
    cache[staff_id] = brief
    return brief


def search_staff(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Поиск по фамилии/ФИО для подтверждения выбора."""
    q = re.sub(r"\s+", " ", (query or "").strip())
    if len(q) < 2:
        return []
    key = q.casefold().replace("ё", "е")
    out = []
    for s in auth.list_staff():
        fio = (s.get("fio") or "").casefold().replace("ё", "е")
        if key in fio or fio.startswith(key) or any(
            p.startswith(key) for p in fio.split()
        ):
            out.append(
                {
                    "id": s["id"],
                    "fio": s.get("fio") or "",
                    "role": s.get("role") or "",
                    "role_label": s.get("role_label")
                    or auth.ROLE_LABELS.get(s.get("role") or "", ""),
                    "callsign": s.get("callsign") or "",
                    "department_id": s.get("department_id") or "",
                    "department_name": s.get("department_name") or "",
                }
            )
        if len(out) >= limit:
            break
    return out


def list_distributions() -> List[Dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM distributions ORDER BY dist_date DESC, created_at DESC"
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            cnt = conn.execute(
                """
                SELECT COUNT(*) AS g,
                       COALESCE(SUM(planned_count), 0) AS planned,
                       COUNT(DISTINCT stream_num) AS streams
                FROM distribution_groups WHERE distribution_id=?
                """,
                (d["id"],),
            ).fetchone()
            d["groups_count"] = int(cnt["g"] or 0)
            d["planned_total"] = int(cnt["planned"] or 0)
            d["streams_count"] = int(cnt["streams"] or 0)
            out.append(d)
    return out


def _load_group_row(conn, row, cache) -> Dict[str, Any]:
    d = dict(row)
    instructors = []
    assistants = []
    for st in conn.execute(
        "SELECT staff_id, role FROM distribution_group_staff WHERE group_row_id=?",
        (d["id"],),
    ):
        brief = _staff_brief(st["staff_id"], cache)
        if not brief:
            continue
        if st["role"] == "instructor":
            instructors.append(brief)
        elif st["role"] == "assistant":
            assistants.append(brief)
    seniors = []
    for st in conn.execute(
        """
        SELECT staff_id FROM distribution_stream_seniors
        WHERE distribution_id=? AND stream_num=?
        """,
        (d["distribution_id"], d["stream_num"]),
    ):
        brief = _staff_brief(st["staff_id"], cache)
        if brief:
            seniors.append(brief)
    d["instructors"] = instructors
    d["assistants"] = assistants
    d["stream_seniors"] = seniors
    return d


def get_distribution(dist_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        cache: Dict[str, Any] = {}
        groups = []
        for g in conn.execute(
            """
            SELECT * FROM distribution_groups
            WHERE distribution_id=?
            ORDER BY stream_num ASC, group_num ASC
            """,
            (dist_id,),
        ):
            groups.append(_load_group_row(conn, g, cache))
        d["groups"] = groups
        d["groups_count"] = len(groups)
        d["planned_total"] = sum(int(g.get("planned_count") or 0) for g in groups)
        streams = sorted({g.get("stream_num") or "" for g in groups if g.get("stream_num")})
        d["streams_count"] = len(streams)
        d["stream_nums"] = streams
    return d


def create_distribution(
    title: str,
    dist_date: str = "",
    note: str = "",
    created_by: str = None,
) -> Dict[str, Any]:
    title = (title or "").strip()
    if not title:
        raise ValueError("Укажите название распределения")
    did = uuid.uuid4().hex
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO distributions(id, title, dist_date, note, created_at, created_by)
            VALUES(?,?,?,?,?,?)
            """,
            (
                did,
                title,
                (dist_date or "").strip(),
                (note or "").strip(),
                db._now(),
                created_by,
            ),
        )
    return get_distribution(did)


def update_distribution(
    dist_id: str,
    *,
    title: Optional[str] = None,
    dist_date: Optional[str] = None,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    cur = get_distribution(dist_id)
    if not cur:
        raise ValueError("Распределение не найдено")
    with db.connect() as conn:
        if title is not None:
            t = (title or "").strip()
            if not t:
                raise ValueError("Укажите название распределения")
            conn.execute(
                "UPDATE distributions SET title=? WHERE id=?", (t, dist_id)
            )
        if dist_date is not None:
            conn.execute(
                "UPDATE distributions SET dist_date=? WHERE id=?",
                ((dist_date or "").strip(), dist_id),
            )
        if note is not None:
            conn.execute(
                "UPDATE distributions SET note=? WHERE id=?",
                ((note or "").strip(), dist_id),
            )
    return get_distribution(dist_id)


def delete_distribution(dist_id: str) -> None:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id FROM distribution_groups WHERE distribution_id=?",
            (dist_id,),
        ).fetchall()
        for r in rows:
            conn.execute(
                "DELETE FROM distribution_group_staff WHERE group_row_id=?",
                (r["id"],),
            )
        conn.execute(
            "DELETE FROM distribution_groups WHERE distribution_id=?", (dist_id,)
        )
        conn.execute(
            "DELETE FROM distribution_stream_seniors WHERE distribution_id=?",
            (dist_id,),
        )
        cur = conn.execute("DELETE FROM distributions WHERE id=?", (dist_id,))
        if cur.rowcount <= 0:
            raise ValueError("Распределение не найдено")


def _set_group_staff(conn, group_row_id: str, role: str, staff_ids: List[str]) -> None:
    conn.execute(
        "DELETE FROM distribution_group_staff WHERE group_row_id=? AND role=?",
        (group_row_id, role),
    )
    for sid in staff_ids:
        if not sid:
            continue
        conn.execute(
            """
            INSERT OR REPLACE INTO distribution_group_staff(group_row_id, staff_id, role)
            VALUES(?,?,?)
            """,
            (group_row_id, sid, role),
        )


def set_stream_seniors(
    dist_id: str, stream_num: str, staff_ids: List[str]
) -> None:
    stream = db._norm_call(stream_num)
    if not stream:
        raise ValueError("Укажите номер потока")
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT id FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not exists:
            raise ValueError("Распределение не найдено")
        conn.execute(
            """
            DELETE FROM distribution_stream_seniors
            WHERE distribution_id=? AND stream_num=?
            """,
            (dist_id, stream),
        )
        for sid in staff_ids:
            if not sid:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO distribution_stream_seniors(
                  distribution_id, stream_num, staff_id
                ) VALUES(?,?,?)
                """,
                (dist_id, stream, sid),
            )


def add_group_row(
    dist_id: str,
    *,
    stream_num: str,
    group_num: str,
    period_from: str = "",
    period_to: str = "",
    planned_count: int = 0,
    classroom: str = "",
    polygon_name: str = "",
    tent_num: str = "",
    note: str = "",
    instructor_ids: Optional[List[str]] = None,
    assistant_ids: Optional[List[str]] = None,
    senior_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    stream = db._norm_call(stream_num)
    group = db._norm_call(group_num)
    if not stream or not group:
        raise ValueError("Укажите поток и группу")
    gid = uuid.uuid4().hex
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT id FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not exists:
            raise ValueError("Распределение не найдено")
        clash = conn.execute(
            """
            SELECT id FROM distribution_groups
            WHERE distribution_id=? AND stream_num=? AND group_num=?
            """,
            (dist_id, stream, group),
        ).fetchone()
        if clash:
            raise ValueError("Такая группа в этом потоке уже есть в распределении")
        conn.execute(
            """
            INSERT INTO distribution_groups(
              id, distribution_id, stream_num, period_from, period_to, group_num,
              planned_count, classroom, polygon_name, tent_num, note, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                gid,
                dist_id,
                stream,
                (period_from or "").strip(),
                (period_to or "").strip(),
                group,
                int(planned_count or 0),
                (classroom or "").strip(),
                (polygon_name or "").strip(),
                (tent_num or "").strip(),
                (note or "").strip(),
                db._now(),
            ),
        )
        if instructor_ids is not None:
            _set_group_staff(conn, gid, "instructor", instructor_ids[:1])
        if assistant_ids is not None:
            _set_group_staff(conn, gid, "assistant", assistant_ids)
        # при добавлении пустой список не трогает уже заданных старших потока
        if senior_ids:
            conn.execute(
                """
                DELETE FROM distribution_stream_seniors
                WHERE distribution_id=? AND stream_num=?
                """,
                (dist_id, stream),
            )
            for sid in senior_ids:
                if not sid:
                    continue
                conn.execute(
                    """
                    INSERT OR REPLACE INTO distribution_stream_seniors(
                      distribution_id, stream_num, staff_id
                    ) VALUES(?,?,?)
                    """,
                    (dist_id, stream, sid),
                )
    dist = get_distribution(dist_id)
    for g in (dist or {}).get("groups") or []:
        if g["id"] == gid:
            return g
    return {"id": gid}


def update_group_row(
    group_row_id: str,
    *,
    stream_num: Optional[str] = None,
    group_num: Optional[str] = None,
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    planned_count: Optional[int] = None,
    classroom: Optional[str] = None,
    polygon_name: Optional[str] = None,
    tent_num: Optional[str] = None,
    note: Optional[str] = None,
    instructor_ids: Optional[List[str]] = None,
    assistant_ids: Optional[List[str]] = None,
    senior_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    with db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM distribution_groups WHERE id=?", (group_row_id,)
        ).fetchone()
        if not cur:
            raise ValueError("Строка группы не найдена")
        dist_id = cur["distribution_id"]
        new_stream = (
            db._norm_call(stream_num)
            if stream_num is not None
            else cur["stream_num"]
        )
        new_group = (
            db._norm_call(group_num) if group_num is not None else cur["group_num"]
        )
        if not new_stream or not new_group:
            raise ValueError("Укажите поток и группу")
        clash = conn.execute(
            """
            SELECT id FROM distribution_groups
            WHERE distribution_id=? AND stream_num=? AND group_num=? AND id!=?
            """,
            (dist_id, new_stream, new_group, group_row_id),
        ).fetchone()
        if clash:
            raise ValueError("Такая группа в этом потоке уже есть в распределении")
        conn.execute(
            """
            UPDATE distribution_groups SET
              stream_num=?, group_num=?,
              period_from=?, period_to=?,
              planned_count=?, classroom=?, polygon_name=?, tent_num=?, note=?
            WHERE id=?
            """,
            (
                new_stream,
                new_group,
                (period_from if period_from is not None else cur["period_from"] or ""),
                (period_to if period_to is not None else cur["period_to"] or ""),
                int(
                    planned_count
                    if planned_count is not None
                    else cur["planned_count"] or 0
                ),
                (classroom if classroom is not None else cur["classroom"] or ""),
                (
                    polygon_name
                    if polygon_name is not None
                    else cur["polygon_name"] or ""
                ),
                (tent_num if tent_num is not None else cur["tent_num"] or ""),
                (note if note is not None else cur["note"] or ""),
                group_row_id,
            ),
        )
        if instructor_ids is not None:
            _set_group_staff(conn, group_row_id, "instructor", instructor_ids[:1])
        if assistant_ids is not None:
            _set_group_staff(conn, group_row_id, "assistant", assistant_ids)
        if senior_ids is not None:
            conn.execute(
                """
                DELETE FROM distribution_stream_seniors
                WHERE distribution_id=? AND stream_num=?
                """,
                (dist_id, new_stream),
            )
            for sid in senior_ids:
                if not sid:
                    continue
                conn.execute(
                    """
                    INSERT OR REPLACE INTO distribution_stream_seniors(
                      distribution_id, stream_num, staff_id
                    ) VALUES(?,?,?)
                    """,
                    (dist_id, new_stream, sid),
                )
    dist = get_distribution(dist_id)
    for g in (dist or {}).get("groups") or []:
        if g["id"] == group_row_id:
            return g
    raise ValueError("Строка группы не найдена")


def delete_group_row(group_row_id: str) -> str:
    """Возвращает distribution_id."""
    with db.connect() as conn:
        cur = conn.execute(
            "SELECT distribution_id FROM distribution_groups WHERE id=?",
            (group_row_id,),
        ).fetchone()
        if not cur:
            raise ValueError("Строка группы не найдена")
        dist_id = cur["distribution_id"]
        conn.execute(
            "DELETE FROM distribution_group_staff WHERE group_row_id=?",
            (group_row_id,),
        )
        conn.execute("DELETE FROM distribution_groups WHERE id=?", (group_row_id,))
    return dist_id


def groups_for_staff(dist_id: str, staff_id: str) -> List[Dict[str, Any]]:
    """Строки распределения, где staff — инструктор или ассистент."""
    dist = get_distribution(dist_id)
    if not dist:
        return []
    sid = (staff_id or "").strip()
    if not sid:
        return []
    out = []
    for g in dist.get("groups") or []:
        ids = {p["id"] for p in (g.get("instructors") or []) + (g.get("assistants") or [])}
        if sid in ids:
            out.append(g)
    return out
