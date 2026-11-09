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


def _attach_group_staff(conn, d: Dict[str, Any], cache: Optional[Dict[str, Any]] = None) -> None:
    """Подтягивает инструктора/ассистентов из исходной строки распределения."""
    if cache is None:
        cache = {}
    instructors: List[Dict[str, Any]] = []
    assistants: List[Dict[str, Any]] = []
    gid = (d.get("distribution_group_id") or "").strip()
    if gid:
        for st in conn.execute(
            """
            SELECT staff_id, role FROM distribution_group_staff
            WHERE group_row_id=?
            ORDER BY CASE role WHEN 'instructor' THEN 0 ELSE 1 END, rowid ASC
            """,
            (gid,),
        ):
            brief = distributions._staff_brief(st["staff_id"], cache)
            if not brief:
                continue
            if st["role"] == "instructor":
                instructors.append(brief)
            elif st["role"] == "assistant":
                assistants.append(brief)
    d["instructors"] = instructors
    d["assistants"] = assistants


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
        d["cadets_filled"] = sum(
            1
            for c in d["cadets"]
            if any(
                (c.get(k) or "").strip()
                for k in ("num", "callsign", "fio", "phone")
            )
        )
        _attach_group_staff(conn, d)
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
        cache: Dict[str, Any] = {}
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
            _attach_group_staff(conn, d, cache)
            out.append(d)
    return out


def my_group_ids_for_staff(staff_id: str, dist_id: str = "") -> set:
    """Id строк распределения, которые уже в «Мои группы».

    Без dist_id — по прямым distribution_group_id.
    С dist_id — ещё и по совпадению поток+группа (чтобы новое распределение
    не предлагало повторно добавить ту же логическую группу).
    """
    if not staff_id:
        return set()
    with db.connect() as conn:
        if not dist_id:
            rows = conn.execute(
                """
                SELECT distribution_group_id FROM my_groups
                WHERE owner_staff_id=? AND trim(distribution_group_id)<>''
                """,
                (staff_id,),
            ).fetchall()
            return {r["distribution_group_id"] for r in rows}

        mine = conn.execute(
            """
            SELECT distribution_group_id, stream_num, group_num
            FROM my_groups
            WHERE owner_staff_id=?
            """,
            (staff_id,),
        ).fetchall()
        if not mine:
            return set()
        by_id = {
            (r["distribution_group_id"] or "").strip()
            for r in mine
            if (r["distribution_group_id"] or "").strip()
        }
        by_sg = {
            (
                (r["stream_num"] or "").strip(),
                (r["group_num"] or "").strip(),
            )
            for r in mine
            if (r["stream_num"] or "").strip() and (r["group_num"] or "").strip()
        }
        claimed = set()
        for g in conn.execute(
            """
            SELECT id, stream_num, group_num FROM distribution_groups
            WHERE distribution_id=?
            """,
            (dist_id,),
        ):
            gid = g["id"]
            sg = ((g["stream_num"] or "").strip(), (g["group_num"] or "").strip())
            if gid in by_id or (sg[0] and sg[1] and sg in by_sg):
                claimed.add(gid)
        return claimed


def _filled_cadet_dicts(src_cadets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "num": c.get("num") or "",
            "callsign": c.get("callsign") or "",
            "fio": c.get("fio") or "",
            "phone": c.get("phone") or "",
            "passport": c.get("passport") or "",
            "note": c.get("note") or "",
        }
        for c in (src_cadets or [])
        if _cadet_filled(c)
    ]


def _write_cadet_slots(
    conn, mid: str, filled: List[Dict[str, Any]], planned: int
) -> None:
    slots = list(filled)
    while len(slots) < planned and len(slots) < 120:
        slots.append(
            {
                "num": "",
                "callsign": "",
                "fio": "",
                "phone": "",
                "passport": "",
                "note": "",
            }
        )
    for i, c in enumerate(slots[:120], 1):
        conn.execute(
            """
            INSERT INTO my_group_cadets(
              id, my_group_id, npp, num, callsign, fio, phone, passport, note
            ) VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                uuid.uuid4().hex,
                mid,
                i,
                c["num"],
                c["callsign"],
                c["fio"],
                c["phone"],
                c["passport"],
                c["note"],
            ),
        )
    if len(slots) > planned:
        conn.execute(
            "UPDATE my_groups SET planned_count=? WHERE id=?",
            (min(len(slots), 120), mid),
        )


def _my_group_has_filled_cadets(conn, mid: str) -> bool:
    row = conn.execute(
        """
        SELECT 1 AS ok FROM my_group_cadets
        WHERE my_group_id=? AND (
          trim(num)<>'' OR trim(callsign)<>'' OR trim(fio)<>''
          OR trim(phone)<>'' OR trim(passport)<>'' OR trim(note)<>''
        )
        LIMIT 1
        """,
        (mid,),
    ).fetchone()
    return bool(row)


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

    planned = int(group.get("planned_count") or 0)
    owner_staff = staff_id or ("admin:" + (user_id or "x"))
    stream_num = (stream or {}).get("stream_num") or group.get("stream_num") or ""
    group_num = group.get("group_num") or ""
    period_from = group.get("period_from") or (stream or {}).get("period_from") or ""
    period_to = group.get("period_to") or (stream or {}).get("period_to") or ""
    polygon_name = (
        group.get("polygon_name") or (stream or {}).get("polygon_name") or ""
    )
    classroom = group.get("classroom") or ""
    tent_num = group.get("tent_num") or ""
    note = group.get("note") or ""
    dist_title = dist.get("title") or ""
    filled_from_dist = _filled_cadet_dicts(group.get("cadets") or [])

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

        # та же логическая группа (поток+номер) — перепривязка, без второй копии
        same = None
        if stream_num and group_num:
            same = conn.execute(
                """
                SELECT id FROM my_groups
                WHERE owner_staff_id=? AND stream_num=? AND group_num=?
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (owner_staff, stream_num, group_num),
            ).fetchone()
        if same:
            mid = same["id"]
            conn.execute(
                """
                UPDATE my_groups SET
                  owner_user_id=?, distribution_id=?, distribution_group_id=?,
                  dist_title=?, stream_num=?, group_num=?,
                  period_from=?, period_to=?, polygon_name=?,
                  planned_count=?, classroom=?, tent_num=?, note=?, my_role=?
                WHERE id=?
                """,
                (
                    user_id,
                    dist_id,
                    group_row_id,
                    dist_title,
                    stream_num,
                    group_num,
                    period_from,
                    period_to,
                    polygon_name,
                    planned,
                    classroom,
                    tent_num,
                    note,
                    my_role,
                    mid,
                ),
            )
            if not _my_group_has_filled_cadets(conn, mid):
                conn.execute(
                    "DELETE FROM my_group_cadets WHERE my_group_id=?", (mid,)
                )
                if filled_from_dist:
                    _write_cadet_slots(conn, mid, filled_from_dist, planned)
                else:
                    _ensure_cadet_slots(conn, mid, planned)
            else:
                _ensure_cadet_slots(conn, mid, planned)
        else:
            mid = uuid.uuid4().hex
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
                    dist_title,
                    stream_num,
                    group_num,
                    period_from,
                    period_to,
                    polygon_name,
                    planned,
                    classroom,
                    tent_num,
                    note,
                    my_role,
                    db._now(),
                ),
            )
            if filled_from_dist:
                _write_cadet_slots(conn, mid, filled_from_dist, planned)
            else:
                _ensure_cadet_slots(conn, mid, planned)
    row = get_my_group(mid, user)
    if not row:
        raise ValueError("Не удалось создать группу")
    return row


def dedupe_my_groups() -> int:
    """Склеить задвоения по owner+поток+группа. Возвращает число удалённых копий."""
    removed = 0
    with db.connect() as conn:
        clusters = conn.execute(
            """
            SELECT owner_staff_id, stream_num, group_num, COUNT(*) AS c
            FROM my_groups
            WHERE trim(stream_num)<>'' AND trim(group_num)<>''
            GROUP BY owner_staff_id, stream_num, group_num
            HAVING c > 1
            """
        ).fetchall()
        for cl in clusters:
            rows = conn.execute(
                """
                SELECT id, distribution_id, distribution_group_id, created_at,
                       classroom, tent_num, note, planned_count, dist_title,
                       period_from, period_to, polygon_name, my_role, owner_user_id
                FROM my_groups
                WHERE owner_staff_id=? AND stream_num=? AND group_num=?
                ORDER BY created_at ASC
                """,
                (cl["owner_staff_id"], cl["stream_num"], cl["group_num"]),
            ).fetchall()
            scored = []
            for r in rows:
                filled = conn.execute(
                    """
                    SELECT COUNT(*) AS c FROM my_group_cadets
                    WHERE my_group_id=? AND (
                      trim(num)<>'' OR trim(callsign)<>'' OR trim(fio)<>''
                      OR trim(phone)<>'' OR trim(passport)<>'' OR trim(note)<>''
                    )
                    """,
                    (r["id"],),
                ).fetchone()
                scored.append((int(filled["c"] or 0), r["created_at"] or "", dict(r)))
            # храним самую заполненную; при равенстве — более новую
            scored.sort(key=lambda t: (t[0], t[1]))
            keeper = scored[-1][2]
            others = [t[2] for t in scored[:-1]]
            newest = max(rows, key=lambda r: r["created_at"] or "")
            # сначала удаляем копии — иначе UNIQUE(owner, distribution_group_id)
            for o in others:
                if o["id"] == keeper["id"]:
                    continue
                conn.execute(
                    "DELETE FROM my_group_cadets WHERE my_group_id=?", (o["id"],)
                )
                conn.execute("DELETE FROM my_groups WHERE id=?", (o["id"],))
                removed += 1
            # метаданные/привязку берём с самой новой строки
            planned = max(
                int(newest["planned_count"] or 0),
                int(keeper.get("planned_count") or 0),
            )
            conn.execute(
                """
                UPDATE my_groups SET
                  owner_user_id=?, distribution_id=?, distribution_group_id=?,
                  dist_title=?, period_from=?, period_to=?, polygon_name=?,
                  planned_count=?, classroom=?, tent_num=?, note=?, my_role=?
                WHERE id=?
                """,
                (
                    newest["owner_user_id"] or keeper.get("owner_user_id") or "",
                    newest["distribution_id"] or "",
                    newest["distribution_group_id"] or "",
                    newest["dist_title"] or keeper.get("dist_title") or "",
                    newest["period_from"] or keeper.get("period_from") or "",
                    newest["period_to"] or keeper.get("period_to") or "",
                    newest["polygon_name"] or keeper.get("polygon_name") or "",
                    planned,
                    (newest["classroom"] or "").strip()
                    or (keeper.get("classroom") or ""),
                    (newest["tent_num"] or "").strip()
                    or (keeper.get("tent_num") or ""),
                    (newest["note"] or "").strip() or (keeper.get("note") or ""),
                    newest["my_role"] or keeper.get("my_role") or "",
                    keeper["id"],
                ),
            )
            _ensure_cadet_slots(conn, keeper["id"], planned)
    return removed


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


def _cadet_filled(c: Dict[str, Any]) -> bool:
    return any(
        (c.get(k) or "").strip()
        for k in ("num", "callsign", "call", "fio", "phone", "passport")
    )


def import_cadets_excel(
    my_group_id: str, user: Dict[str, Any], raw: bytes
) -> Dict[str, Any]:
    """Загрузка курсантов из шаблона Excel в «Мою группу».

    Заполняет пустые строки; при нехватке мест расширяет таблицу (до 120).
    Повтор номера в группе пропускается.
    """
    from .excel_templates import parse_cadets_sheet

    cur = get_my_group(my_group_id, user)
    if not cur:
        raise ValueError("Группа не найдена")
    entries, file_dups = parse_cadets_sheet(raw)
    if not entries and not file_dups:
        raise ValueError("В файле нет строк курсантов")

    existing = list(cur.get("cadets") or [])
    seen_nums = {
        db._norm_call(c.get("num") or "")
        for c in existing
        if db._norm_call(c.get("num") or "")
    }
    incoming: List[Dict[str, Any]] = []
    skipped: List[str] = []
    for e in entries:
        num = db._norm_call(e.get("num") or "")
        if not num:
            continue
        if num in seen_nums:
            skipped.append(num)
            continue
        seen_nums.add(num)
        incoming.append(
            {
                "num": num,
                "callsign": db._norm_call(e.get("call") or ""),
                "fio": db._norm_fio(e.get("fio") or ""),
                "phone": db._norm_call(e.get("phone") or ""),
                "passport": db._norm_call(e.get("passport") or ""),
                "note": (e.get("note") or "").strip(),
            }
        )

    merged: List[Dict[str, Any]] = []
    qi = 0
    for c in existing:
        if _cadet_filled(c):
            merged.append(
                {
                    "num": c.get("num") or "",
                    "callsign": c.get("callsign") or "",
                    "fio": c.get("fio") or "",
                    "phone": c.get("phone") or "",
                    "passport": c.get("passport") or "",
                    "note": c.get("note") or "",
                }
            )
        elif qi < len(incoming):
            merged.append(incoming[qi])
            qi += 1
        else:
            merged.append(
                {
                    "num": "",
                    "callsign": "",
                    "fio": "",
                    "phone": "",
                    "passport": "",
                    "note": "",
                }
            )
    while qi < len(incoming) and len(merged) < 120:
        merged.append(incoming[qi])
        qi += 1

    planned = max(int(cur.get("planned_count") or 0), len(merged))
    planned = min(planned, 120)
    with db.connect() as conn:
        conn.execute(
            "UPDATE my_groups SET planned_count=? WHERE id=?",
            (planned, my_group_id),
        )
    group = save_my_group_cadets(my_group_id, user, merged)
    return {
        "group": group,
        "added": qi,
        "skipped_nums": skipped,
        "file_duplicates": len(file_dups or []),
        "left": max(0, len(incoming) - qi),
        "total_in_file": len(entries),
    }
