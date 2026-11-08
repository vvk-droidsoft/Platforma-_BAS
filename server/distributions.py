# -*- coding: utf-8 -*-
"""Учебные распределения: документ → потоки (шапка) → группы."""
from __future__ import annotations

import re
import uuid
from datetime import datetime
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
        "role_label": auth.role_label(role),
        "callsign": s.get("callsign") or "",
        "department_id": s.get("department_id") or "",
        "department_name": s.get("department_name") or "",
    }
    cache[staff_id] = brief
    return brief


def _staff_brief_from_row(s: Dict[str, Any]) -> Dict[str, Any]:
    role = s.get("role") or ""
    return {
        "id": s["id"],
        "fio": s.get("fio") or "",
        "role": role,
        "role_label": s.get("role_label")
        or auth.role_label(role),
        "callsign": s.get("callsign") or "",
        "department_id": s.get("department_id") or "",
        "department_name": s.get("department_name") or "",
    }


def search_staff(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Поиск по фамилии/ФИО для подтверждения выбора."""
    return match_staff_queries(query, limit=limit)


def match_staff_queries(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Совпадения по фамилии или «фамилия имя» (порядок штатки не важен).

    Должность берётся из штатки (role_label). Сначала точные совпадения, затем
    по префиксу фамилии/ФИО — без автовыбора «первого попавшегося» снаружи.
    """
    q = re.sub(r"\s+", " ", (query or "").strip())
    if len(q) < 2:
        return []
    key = q.casefold().replace("ё", "е")
    exact: List[Dict[str, Any]] = []
    prefix: List[Dict[str, Any]] = []
    partial: List[Dict[str, Any]] = []
    seen = set()
    for s in auth.list_staff():
        brief = _staff_brief_from_row(s)
        sid = brief["id"]
        if sid in seen:
            continue
        fio = (brief.get("fio") or "").casefold().replace("ё", "е")
        if not fio:
            continue
        parts = fio.split()
        surname = parts[0] if parts else ""
        fio_short = " ".join(parts[:2]) if len(parts) >= 2 else fio
        if fio == key or surname == key or fio_short == key:
            seen.add(sid)
            exact.append(brief)
            continue
        # «Фамилия И» / «Фамилия И.»
        short_key = re.sub(r"\s+([а-яa-z])\.\s*", r" \1", key)
        short_key = re.sub(r"\.", "", short_key).strip()
        if len(parts) >= 2 and (surname + " " + parts[1][:1]) == short_key:
            seen.add(sid)
            exact.append(brief)
            continue
        if (
            fio.startswith(key)
            or surname.startswith(key)
            or (len(parts) >= 2 and fio_short.startswith(key))
        ):
            seen.add(sid)
            prefix.append(brief)
            continue
        if key in fio:
            seen.add(sid)
            partial.append(brief)
    out = exact + prefix + partial
    return out[:limit]


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
                SELECT
                  (SELECT COUNT(*) FROM distribution_streams WHERE distribution_id=?) AS streams,
                  (SELECT COUNT(*) FROM distribution_groups WHERE distribution_id=?) AS g,
                  (SELECT COALESCE(SUM(planned_count), 0) FROM distribution_groups
                   WHERE distribution_id=?) AS planned
                """,
                (d["id"], d["id"], d["id"]),
            ).fetchone()
            d["streams_count"] = int(cnt["streams"] or 0)
            d["groups_count"] = int(cnt["g"] or 0)
            d["planned_total"] = int(cnt["planned"] or 0)
            out.append(d)
    return out


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


def _set_stream_seniors(conn, dist_id: str, stream_num: str, staff_ids: List[str]) -> None:
    conn.execute(
        """
        DELETE FROM distribution_stream_seniors
        WHERE distribution_id=? AND stream_num=?
        """,
        (dist_id, stream_num),
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
            (dist_id, stream_num, sid),
        )


def _sync_group_stream_fields(
    conn, dist_id: str, stream_num: str, period_from: str, period_to: str, polygon: str
) -> None:
    """Полигон из шапки потока; период группы свой (не затираем ручной ввод).
    Пустой период у группы подставляем из потока как стартовое значение.
    """
    conn.execute(
        """
        UPDATE distribution_groups
        SET polygon_name=?,
            period_from=CASE
              WHEN trim(COALESCE(period_from,''))='' AND trim(COALESCE(period_to,''))=''
              THEN ? ELSE period_from END,
            period_to=CASE
              WHEN trim(COALESCE(period_from,''))='' AND trim(COALESCE(period_to,''))=''
              THEN ? ELSE period_to END
        WHERE distribution_id=? AND stream_num=?
        """,
        (
            polygon or "",
            period_from or "",
            period_to or "",
            dist_id,
            stream_num,
        ),
    )


def _validate_training_period(period_from: str, period_to: str) -> None:
    """Дата начала не позже даты окончания. Короткий период допускается (предупреждение на UI)."""
    pf = (period_from or "").strip()
    pt = (period_to or "").strip()
    if not pf and not pt:
        return
    if pf and not pt:
        raise ValueError("Укажите дату окончания периода обучения")
    if pt and not pf:
        raise ValueError("Укажите дату начала периода обучения")
    try:
        d0 = datetime.strptime(pf[:10], "%Y-%m-%d").date()
        d1 = datetime.strptime(pt[:10], "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Некорректный формат дат периода обучения") from None
    if d0 > d1:
        raise ValueError(
            "Дата начала обучения не может быть позже даты окончания обучения"
        )


def _load_group_cadets(conn, group_row_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT * FROM distribution_group_cadets
        WHERE group_row_id=?
        ORDER BY npp ASC, rowid ASC
        """,
        (group_row_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _cadet_filled(c: Dict[str, Any]) -> bool:
    return any(
        (c.get(k) or "").strip()
        for k in ("num", "callsign", "call", "fio", "phone", "passport")
    )


def _replace_group_cadets(conn, group_row_id: str, cadets: List[Dict[str, Any]]) -> None:
    conn.execute(
        "DELETE FROM distribution_group_cadets WHERE group_row_id=?",
        (group_row_id,),
    )
    for i, c in enumerate(cadets[:120], 1):
        conn.execute(
            """
            INSERT INTO distribution_group_cadets(
              id, group_row_id, npp, num, callsign, fio, phone, passport, note
            ) VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                uuid.uuid4().hex,
                group_row_id,
                i,
                (c.get("num") or "").strip(),
                (c.get("callsign") or c.get("call") or "").strip(),
                (c.get("fio") or "").strip(),
                (c.get("phone") or "").strip(),
                (c.get("passport") or "").strip(),
                (c.get("note") or "").strip(),
            ),
        )


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
    d["instructors"] = instructors
    d["assistants"] = assistants
    cadets = _load_group_cadets(conn, d["id"])
    d["cadets"] = cadets
    d["cadets_filled"] = sum(1 for c in cadets if _cadet_filled(c))
    return d


def _load_stream(conn, row, cache) -> Dict[str, Any]:
    s = dict(row)
    dist_id = s["distribution_id"]
    stream_num = s["stream_num"]
    seniors = []
    for st in conn.execute(
        """
        SELECT staff_id FROM distribution_stream_seniors
        WHERE distribution_id=? AND stream_num=?
        """,
        (dist_id, stream_num),
    ):
        brief = _staff_brief(st["staff_id"], cache)
        if brief:
            seniors.append(brief)
    s["seniors"] = seniors
    groups = []
    for g in conn.execute(
        """
        SELECT * FROM distribution_groups
        WHERE distribution_id=? AND stream_num=?
        ORDER BY group_num ASC
        """,
        (dist_id, stream_num),
    ):
        groups.append(_load_group_row(conn, g, cache))
    s["groups"] = groups
    s["groups_count"] = len(groups)
    s["planned_total"] = sum(int(g.get("planned_count") or 0) for g in groups)
    return s


def get_distribution(dist_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        cache: Dict[str, Any] = {}
        streams = []
        for s in conn.execute(
            """
            SELECT * FROM distribution_streams
            WHERE distribution_id=?
            ORDER BY stream_num ASC
            """,
            (dist_id,),
        ):
            streams.append(_load_stream(conn, s, cache))
        # группы без шапки потока (старые данные) — создаём виртуальные шапки
        covered = {s["stream_num"] for s in streams}
        orphan_nums = conn.execute(
            """
            SELECT DISTINCT stream_num FROM distribution_groups
            WHERE distribution_id=? AND trim(stream_num)<>''
            """,
            (dist_id,),
        ).fetchall()
        for o in orphan_nums:
            num = o["stream_num"]
            if num in covered:
                continue
            first = conn.execute(
                """
                SELECT period_from, period_to, polygon_name FROM distribution_groups
                WHERE distribution_id=? AND stream_num=? LIMIT 1
                """,
                (dist_id, num),
            ).fetchone()
            virtual = {
                "id": "",
                "distribution_id": dist_id,
                "stream_num": num,
                "period_from": (first["period_from"] if first else "") or "",
                "period_to": (first["period_to"] if first else "") or "",
                "polygon_name": (first["polygon_name"] if first else "") or "",
                "note": "",
                "created_at": "",
            }
            streams.append(_load_stream(conn, virtual, cache))
        streams.sort(
            key=lambda x: (
                str(x.get("stream_num") or ""),
            )
        )
        d["streams"] = streams
        flat_groups = []
        for s in streams:
            for g in s.get("groups") or []:
                g2 = dict(g)
                g2["stream_num"] = s.get("stream_num")
                # период и полигон — у группы свои; поток только как запасной вариант
                if not (g2.get("period_from") or g2.get("period_to")):
                    g2["period_from"] = s.get("period_from") or ""
                    g2["period_to"] = s.get("period_to") or ""
                if not (g2.get("polygon_name") or "").strip():
                    g2["polygon_name"] = s.get("polygon_name") or ""
                g2["stream_seniors"] = s.get("seniors") or []
                flat_groups.append(g2)
        d["groups"] = flat_groups
        d["groups_count"] = len(flat_groups)
        d["planned_total"] = sum(int(g.get("planned_count") or 0) for g in flat_groups)
        d["streams_count"] = len(streams)
        d["stream_nums"] = [s.get("stream_num") or "" for s in streams]
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
        conn.execute(
            "DELETE FROM distribution_streams WHERE distribution_id=?", (dist_id,)
        )
        cur = conn.execute("DELETE FROM distributions WHERE id=?", (dist_id,))
        if cur.rowcount <= 0:
            raise ValueError("Распределение не найдено")


def add_stream(
    dist_id: str,
    *,
    stream_num: str,
    period_from: str = "",
    period_to: str = "",
    polygon_name: str = "",
    note: str = "",
    senior_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    stream = db._norm_call(stream_num)
    if not stream:
        raise ValueError("Укажите номер потока")
    sid = uuid.uuid4().hex
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT id FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not exists:
            raise ValueError("Распределение не найдено")
        clash = conn.execute(
            """
            SELECT id FROM distribution_streams
            WHERE distribution_id=? AND stream_num=?
            """,
            (dist_id, stream),
        ).fetchone()
        if clash:
            raise ValueError("Такой поток уже есть в распределении")
        pf = (period_from or "").strip()
        pt = (period_to or "").strip()
        poly = (polygon_name or "").strip()
        conn.execute(
            """
            INSERT INTO distribution_streams(
              id, distribution_id, stream_num, period_from, period_to,
              polygon_name, note, created_at
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (sid, dist_id, stream, pf, pt, poly, (note or "").strip(), db._now()),
        )
        if senior_ids is not None:
            _set_stream_seniors(conn, dist_id, stream, senior_ids)
        _sync_group_stream_fields(conn, dist_id, stream, pf, pt, poly)
    dist = get_distribution(dist_id)
    for s in (dist or {}).get("streams") or []:
        if s["id"] == sid:
            return s
    return {"id": sid}


def update_stream(
    stream_id: str,
    *,
    stream_num: Optional[str] = None,
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    polygon_name: Optional[str] = None,
    note: Optional[str] = None,
    senior_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    with db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM distribution_streams WHERE id=?", (stream_id,)
        ).fetchone()
        if not cur:
            raise ValueError("Поток не найден")
        dist_id = cur["distribution_id"]
        old_num = cur["stream_num"]
        new_num = (
            db._norm_call(stream_num) if stream_num is not None else old_num
        )
        if not new_num:
            raise ValueError("Укажите номер потока")
        if new_num != old_num:
            clash = conn.execute(
                """
                SELECT id FROM distribution_streams
                WHERE distribution_id=? AND stream_num=? AND id!=?
                """,
                (dist_id, new_num, stream_id),
            ).fetchone()
            if clash:
                raise ValueError("Такой поток уже есть в распределении")
            # перенос групп и старших на новый номер
            conn.execute(
                """
                UPDATE distribution_groups SET stream_num=?
                WHERE distribution_id=? AND stream_num=?
                """,
                (new_num, dist_id, old_num),
            )
            conn.execute(
                """
                UPDATE distribution_stream_seniors SET stream_num=?
                WHERE distribution_id=? AND stream_num=?
                """,
                (new_num, dist_id, old_num),
            )
        pf = (
            (period_from if period_from is not None else cur["period_from"] or "")
            or ""
        ).strip()
        pt = (
            (period_to if period_to is not None else cur["period_to"] or "") or ""
        ).strip()
        poly = (
            (
                polygon_name
                if polygon_name is not None
                else cur["polygon_name"] or ""
            )
            or ""
        ).strip()
        nt = (
            (note if note is not None else cur["note"] or "") or ""
        ).strip()
        conn.execute(
            """
            UPDATE distribution_streams SET
              stream_num=?, period_from=?, period_to=?, polygon_name=?, note=?
            WHERE id=?
            """,
            (new_num, pf, pt, poly, nt, stream_id),
        )
        if senior_ids is not None:
            _set_stream_seniors(conn, dist_id, new_num, senior_ids)
        _sync_group_stream_fields(conn, dist_id, new_num, pf, pt, poly)
    dist = get_distribution(dist_id)
    for s in (dist or {}).get("streams") or []:
        if s["id"] == stream_id or (
            not stream_id and s.get("stream_num") == new_num
        ):
            if s["id"] == stream_id:
                return s
    for s in (dist or {}).get("streams") or []:
        if s.get("stream_num") == new_num:
            return s
    raise ValueError("Поток не найден")


def delete_stream(stream_id: str) -> str:
    """Удаляет поток и все его группы. Возвращает distribution_id."""
    with db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM distribution_streams WHERE id=?", (stream_id,)
        ).fetchone()
        if not cur:
            raise ValueError("Поток не найден")
        dist_id = cur["distribution_id"]
        stream_num = cur["stream_num"]
        groups = conn.execute(
            """
            SELECT id FROM distribution_groups
            WHERE distribution_id=? AND stream_num=?
            """,
            (dist_id, stream_num),
        ).fetchall()
        for g in groups:
            conn.execute(
                "DELETE FROM distribution_group_staff WHERE group_row_id=?",
                (g["id"],),
            )
        conn.execute(
            """
            DELETE FROM distribution_groups
            WHERE distribution_id=? AND stream_num=?
            """,
            (dist_id, stream_num),
        )
        conn.execute(
            """
            DELETE FROM distribution_stream_seniors
            WHERE distribution_id=? AND stream_num=?
            """,
            (dist_id, stream_num),
        )
        conn.execute("DELETE FROM distribution_streams WHERE id=?", (stream_id,))
    return dist_id


def add_group_row(
    dist_id: str,
    *,
    stream_num: str = "",
    stream_id: str = "",
    group_num: str,
    planned_count: int = 0,
    classroom: str = "",
    tent_num: str = "",
    note: str = "",
    instructor_ids: Optional[List[str]] = None,
    assistant_ids: Optional[List[str]] = None,
    # устаревшие поля шапки — игнорируются, если есть stream
    period_from: str = "",
    period_to: str = "",
    polygon_name: str = "",
    senior_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    group = db._norm_call(group_num)
    if not group:
        raise ValueError("Укажите номер группы")
    gid = uuid.uuid4().hex
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT id FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not exists:
            raise ValueError("Распределение не найдено")
        stream_row = None
        if stream_id:
            stream_row = conn.execute(
                "SELECT * FROM distribution_streams WHERE id=? AND distribution_id=?",
                (stream_id, dist_id),
            ).fetchone()
            if not stream_row:
                raise ValueError("Поток не найден")
        else:
            stream = db._norm_call(stream_num)
            if not stream:
                raise ValueError("Укажите поток")
            stream_row = conn.execute(
                """
                SELECT * FROM distribution_streams
                WHERE distribution_id=? AND stream_num=?
                """,
                (dist_id, stream),
            ).fetchone()
            if not stream_row:
                # создаём шапку на лету (совместимость)
                new_sid = uuid.uuid4().hex
                pf = (period_from or "").strip()
                pt = (period_to or "").strip()
                poly = (polygon_name or "").strip()
                conn.execute(
                    """
                    INSERT INTO distribution_streams(
                      id, distribution_id, stream_num, period_from, period_to,
                      polygon_name, note, created_at
                    ) VALUES(?,?,?,?,?,?,?,?)
                    """,
                    (new_sid, dist_id, stream, pf, pt, poly, "", db._now()),
                )
                if senior_ids:
                    _set_stream_seniors(conn, dist_id, stream, senior_ids)
                stream_row = conn.execute(
                    "SELECT * FROM distribution_streams WHERE id=?", (new_sid,)
                ).fetchone()
        stream = stream_row["stream_num"]
        pf = (period_from or "").strip() or (stream_row["period_from"] or "")
        pt = (period_to or "").strip() or (stream_row["period_to"] or "")
        poly = (polygon_name or "").strip() or (stream_row["polygon_name"] or "")
        _validate_training_period(pf, pt)
        clash = conn.execute(
            """
            SELECT id FROM distribution_groups
            WHERE distribution_id=? AND stream_num=? AND group_num=?
            """,
            (dist_id, stream, group),
        ).fetchone()
        if clash:
            raise ValueError("Такая группа в этом потоке уже есть")
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
                pf,
                pt,
                group,
                int(planned_count or 0),
                (classroom or "").strip(),
                poly,
                (tent_num or "").strip(),
                (note or "").strip(),
                db._now(),
            ),
        )
        if instructor_ids is not None:
            _set_group_staff(conn, gid, "instructor", instructor_ids[:1])
        if assistant_ids is not None:
            _set_group_staff(conn, gid, "assistant", assistant_ids)
    dist = get_distribution(dist_id)
    for s in (dist or {}).get("streams") or []:
        for g in s.get("groups") or []:
            if g["id"] == gid:
                g2 = dict(g)
                g2["distribution_id"] = dist_id
                g2["stream_num"] = s.get("stream_num")
                return g2
    return {"id": gid, "distribution_id": dist_id}


def update_group_row(
    group_row_id: str,
    *,
    group_num: Optional[str] = None,
    planned_count: Optional[int] = None,
    classroom: Optional[str] = None,
    tent_num: Optional[str] = None,
    note: Optional[str] = None,
    instructor_ids: Optional[List[str]] = None,
    assistant_ids: Optional[List[str]] = None,
    # игнор шапки
    stream_num: Optional[str] = None,
    period_from: Optional[str] = None,
    period_to: Optional[str] = None,
    polygon_name: Optional[str] = None,
    senior_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    with db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM distribution_groups WHERE id=?", (group_row_id,)
        ).fetchone()
        if not cur:
            raise ValueError("Строка группы не найдена")
        dist_id = cur["distribution_id"]
        stream = cur["stream_num"]
        # смена потока через stream_num — только если поток существует
        if stream_num is not None:
            new_stream = db._norm_call(stream_num)
            if new_stream and new_stream != stream:
                st = conn.execute(
                    """
                    SELECT * FROM distribution_streams
                    WHERE distribution_id=? AND stream_num=?
                    """,
                    (dist_id, new_stream),
                ).fetchone()
                if not st:
                    raise ValueError("Сначала создайте поток в шапке")
                stream = new_stream
        new_group = (
            db._norm_call(group_num) if group_num is not None else cur["group_num"]
        )
        if not new_group:
            raise ValueError("Укажите номер группы")
        clash = conn.execute(
            """
            SELECT id FROM distribution_groups
            WHERE distribution_id=? AND stream_num=? AND group_num=? AND id!=?
            """,
            (dist_id, stream, new_group, group_row_id),
        ).fetchone()
        if clash:
            raise ValueError("Такая группа в этом потоке уже есть")
        stream_row = conn.execute(
            """
            SELECT * FROM distribution_streams
            WHERE distribution_id=? AND stream_num=?
            """,
            (dist_id, stream),
        ).fetchone()
        if period_from is not None:
            pf = (period_from or "").strip()
        else:
            pf = (cur["period_from"] or "") or ""
        if period_to is not None:
            pt = (period_to or "").strip()
        else:
            pt = (cur["period_to"] or "") or ""
        if not pf and not pt and stream_row:
            pf = stream_row["period_from"] or ""
            pt = stream_row["period_to"] or ""
        _validate_training_period(pf, pt)
        if polygon_name is not None:
            poly = (polygon_name or "").strip()
        else:
            poly = (cur["polygon_name"] or "") or ""
            if not poly and stream_row:
                poly = stream_row["polygon_name"] or ""
        conn.execute(
            """
            UPDATE distribution_groups SET
              stream_num=?, group_num=?,
              period_from=?, period_to=?,
              planned_count=?, classroom=?, polygon_name=?, tent_num=?, note=?
            WHERE id=?
            """,
            (
                stream,
                new_group,
                pf,
                pt,
                int(
                    planned_count
                    if planned_count is not None
                    else cur["planned_count"] or 0
                ),
                (classroom if classroom is not None else cur["classroom"] or ""),
                poly,
                (tent_num if tent_num is not None else cur["tent_num"] or ""),
                (note if note is not None else cur["note"] or ""),
                group_row_id,
            ),
        )
        if instructor_ids is not None:
            _set_group_staff(conn, group_row_id, "instructor", instructor_ids[:1])
        if assistant_ids is not None:
            _set_group_staff(conn, group_row_id, "assistant", assistant_ids)
    dist = get_distribution(dist_id)
    for s in (dist or {}).get("streams") or []:
        for g in s.get("groups") or []:
            if g["id"] == group_row_id:
                g2 = dict(g)
                g2["distribution_id"] = dist_id
                g2["stream_num"] = s.get("stream_num")
                return g2
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
            "DELETE FROM distribution_group_cadets WHERE group_row_id=?",
            (group_row_id,),
        )
        conn.execute(
            "DELETE FROM distribution_group_staff WHERE group_row_id=?",
            (group_row_id,),
        )
        conn.execute("DELETE FROM distribution_groups WHERE id=?", (group_row_id,))
    return dist_id


def import_group_cadets_excel(group_row_id: str, raw: bytes) -> Dict[str, Any]:
    """Загрузка курсантов из шаблона Excel в конкретную группу распределения."""
    from .excel_templates import parse_cadets_sheet

    with db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM distribution_groups WHERE id=?", (group_row_id,)
        ).fetchone()
        if not cur:
            raise ValueError("Группа не найдена")
        dist_id = cur["distribution_id"]
        existing = _load_group_cadets(conn, group_row_id)

    entries, file_dups = parse_cadets_sheet(raw)
    if not entries and not file_dups:
        raise ValueError("В файле нет строк курсантов")

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

    planned = max(int(cur["planned_count"] or 0), len(merged), len(existing))
    planned = min(max(planned, 0), 120)
    # добить пустыми до плана, если импорт короче плана
    while len(merged) < planned:
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

    with db.connect() as conn:
        conn.execute(
            "UPDATE distribution_groups SET planned_count=? WHERE id=?",
            (planned, group_row_id),
        )
        _replace_group_cadets(conn, group_row_id, merged)

    dist = get_distribution(dist_id)
    group = None
    for s in (dist or {}).get("streams") or []:
        for g in s.get("groups") or []:
            if g.get("id") == group_row_id:
                group = g
                break
        if group:
            break
    return {
        "group": group,
        "distribution": dist,
        "added": qi,
        "skipped_nums": skipped,
        "file_duplicates": len(file_dups or []),
        "left": max(0, len(incoming) - qi),
        "total_in_file": len(entries),
    }


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
        ids = {
            p["id"]
            for p in (g.get("instructors") or []) + (g.get("assistants") or [])
        }
        if sid in ids:
            out.append(g)
    return out


def norms_roster_for_staff(staff_id: str) -> Dict[str, Any]:
    """Курсанты из распределения для групп, где сотрудник — инструктор/ассистент.

    Берём более новые распределения первыми; одинаковые (поток, группа)
    из старых документов пропускаем.
    """
    sid = (staff_id or "").strip()
    instructor = ""
    if sid:
        st = auth.get_staff(sid)
        if st:
            instructor = (st.get("fio") or st.get("callsign") or "").strip()
    if not sid:
        return {"groups": [], "cadets": [], "instructor": instructor}

    groups_out: List[Dict[str, Any]] = []
    cadets_out: List[Dict[str, Any]] = []
    seen_gk: set = set()
    seen_cs: set = set()

    for dmeta in list_distributions():
        dist = get_distribution(dmeta["id"])
        if not dist:
            continue
        for g in groups_for_staff(dist["id"], sid):
            stream = str(g.get("stream_num") or "").strip()
            group = str(g.get("group_num") or "").strip()
            gk = (stream, group)
            if gk in seen_gk and gk != ("", ""):
                continue
            seen_gk.add(gk)
            my_role = ""
            for p in g.get("instructors") or []:
                if p.get("id") == sid:
                    my_role = "instructor"
                    break
            if not my_role:
                for p in g.get("assistants") or []:
                    if p.get("id") == sid:
                        my_role = "assistant"
                        break
            groups_out.append(
                {
                    "id": g.get("id") or "",
                    "distribution_id": dist.get("id") or "",
                    "dist_title": dist.get("title") or "",
                    "stream_num": stream,
                    "group_num": group,
                    "my_role": my_role,
                }
            )
            for c in g.get("cadets") or []:
                if not _cadet_filled(c):
                    continue
                cs = (c.get("callsign") or c.get("call") or "").strip()
                if not cs:
                    fio = (c.get("fio") or "").strip()
                    if not fio:
                        continue
                    cs = fio
                ck = (stream, group, cs.lower())
                if ck in seen_cs:
                    continue
                seen_cs.add(ck)
                cadets_out.append(
                    {
                        "id": c.get("id") or "",
                        "num": (c.get("num") or "").strip(),
                        "callsign": cs,
                        "stream": stream,
                        "group": group,
                        "fio": (c.get("fio") or "").strip(),
                        "phone": (c.get("phone") or "").strip(),
                        "note": (c.get("note") or "").strip(),
                        "npp": int(c.get("npp") or 0),
                    }
                )

    cadets_out.sort(
        key=lambda x: (
            str(x.get("stream") or ""),
            str(x.get("group") or ""),
            int(x.get("npp") or 0),
            str(x.get("callsign") or "").lower(),
        )
    )
    return {
        "groups": groups_out,
        "cadets": cadets_out,
        "instructor": instructor,
    }


def import_distribution_row(
    dist_id: str, row: Dict[str, Any]
) -> tuple:
    """Импорт одной строки Excel. Возвращает (status, group_id, warnings)."""
    from .training import resolve_staff_by_fio, split_people

    stream = db._norm_call(row.get("stream") or "")
    group = db._norm_call(row.get("group") or "")
    if not stream or not group:
        return "skipped", "", ["Нет потока или группы"]
    warnings: List[str] = []
    planned = 0
    try:
        planned = int(re.sub(r"\D+", "", str(row.get("count") or "0")) or 0)
    except ValueError:
        planned = 0

    period_from = (row.get("period_from") or "").strip()
    period_to = (row.get("period_to") or "").strip()
    polygon = (row.get("polygon") or "").strip()
    classroom = (row.get("classroom") or "").strip()
    tent = (row.get("tent") or "").strip()
    note = (row.get("note") or "").strip()

    senior_ids: List[str] = []
    for fio in split_people(row.get("seniors") or ""):
        st = resolve_staff_by_fio(fio)
        if st:
            senior_ids.append(st["id"])
        else:
            warnings.append("Старший потока не найден в штатке: " + fio)

    inst_ids: List[str] = []
    for fio in split_people(row.get("instructor") or ""):
        st = resolve_staff_by_fio(fio)
        if st:
            inst_ids.append(st["id"])
        else:
            warnings.append("Инструктор не найден в штатке: " + fio)
    if len(inst_ids) > 1:
        warnings.append("Указано несколько инструкторов — взят первый")
        inst_ids = inst_ids[:1]

    asst_ids: List[str] = []
    for fio in split_people(row.get("assistants") or ""):
        st = resolve_staff_by_fio(fio)
        if st:
            asst_ids.append(st["id"])
        else:
            warnings.append("Ассистент не найден в штатке: " + fio)

    with db.connect() as conn:
        exists = conn.execute(
            "SELECT id FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not exists:
            raise ValueError("Распределение не найдено")

        stream_row = conn.execute(
            """
            SELECT * FROM distribution_streams
            WHERE distribution_id=? AND stream_num=?
            """,
            (dist_id, stream),
        ).fetchone()
        if not stream_row:
            sid = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO distribution_streams(
                  id, distribution_id, stream_num, period_from, period_to,
                  polygon_name, note, created_at
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    sid,
                    dist_id,
                    stream,
                    period_from,
                    period_to,
                    polygon,
                    "",
                    db._now(),
                ),
            )
            if senior_ids:
                _set_stream_seniors(conn, dist_id, stream, senior_ids)
        else:
            sid = stream_row["id"]
            pf = period_from or (stream_row["period_from"] or "")
            pt = period_to or (stream_row["period_to"] or "")
            poly = polygon or (stream_row["polygon_name"] or "")
            conn.execute(
                """
                UPDATE distribution_streams SET
                  period_from=?, period_to=?, polygon_name=?
                WHERE id=?
                """,
                (pf, pt, poly, sid),
            )
            if senior_ids:
                _set_stream_seniors(conn, dist_id, stream, senior_ids)
            period_from, period_to, polygon = pf, pt, poly

        existed = conn.execute(
            """
            SELECT id FROM distribution_groups
            WHERE distribution_id=? AND stream_num=? AND group_num=?
            """,
            (dist_id, stream, group),
        ).fetchone()
        if existed:
            gid = existed["id"]
            conn.execute(
                """
                UPDATE distribution_groups SET
                  period_from=?, period_to=?, planned_count=?,
                  classroom=?, polygon_name=?, tent_num=?, note=?
                WHERE id=?
                """,
                (
                    period_from,
                    period_to,
                    planned,
                    classroom,
                    polygon,
                    tent,
                    note,
                    gid,
                ),
            )
            status = "updated"
        else:
            gid = uuid.uuid4().hex
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
                    period_from,
                    period_to,
                    group,
                    planned,
                    classroom,
                    polygon,
                    tent,
                    note,
                    db._now(),
                ),
            )
            status = "added"

        if inst_ids:
            _set_group_staff(conn, gid, "instructor", inst_ids)
        if asst_ids:
            _set_group_staff(conn, gid, "assistant", asst_ids)
        _sync_group_stream_fields(
            conn, dist_id, stream, period_from, period_to, polygon
        )

    return status, gid, warnings
