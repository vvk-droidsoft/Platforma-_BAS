# -*- coding: utf-8 -*-
"""Учебные потоки/группы и закрепление инструкторского состава."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from . import auth
from . import db


def _norm_fio_key(fio: str) -> str:
    s = (fio or "").replace("ё", "е").replace("Ё", "Е")
    s = re.sub(r"\s+", " ", s).strip().casefold()
    return s


def resolve_staff_by_fio(fio: str) -> Optional[Dict[str, Any]]:
    key = _norm_fio_key(fio)
    if not key:
        return None
    staff = auth.list_staff()
    # точное совпадение
    for s in staff:
        if _norm_fio_key(s.get("fio") or "") == key:
            return s
    # «Фамилия И.» ↔ «Фамилия Имя»
    short = re.sub(r"\s+([а-яa-z])\.\s*", r" \1", key)
    short = re.sub(r"\.", "", short).strip()
    for s in staff:
        full = _norm_fio_key(s.get("fio") or "")
        parts = full.split()
        if len(parts) >= 2:
            cand = parts[0] + " " + parts[1][:1]
            if cand == short or full.startswith(short):
                return s
        if full.startswith(key) or key.startswith(full):
            return s
    return None


def split_people(text: str) -> List[str]:
    raw = (text or "").replace(";", ",").replace(" и ", ",")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts


def set_group_staff(conn, group_id: str, role: str, staff_ids: List[str]) -> None:
    conn.execute(
        "DELETE FROM training_group_staff WHERE group_id=? AND role=?",
        (group_id, role),
    )
    for sid in staff_ids:
        if not sid:
            continue
        conn.execute(
            """
            INSERT OR REPLACE INTO training_group_staff(group_id, staff_id, role)
            VALUES(?,?,?)
            """,
            (group_id, sid, role),
        )


def set_stream_seniors(conn, stream_id: str, staff_ids: List[str]) -> None:
    conn.execute(
        "DELETE FROM training_stream_staff WHERE stream_id=?", (stream_id,)
    )
    for sid in staff_ids:
        if not sid:
            continue
        conn.execute(
            """
            INSERT OR REPLACE INTO training_stream_staff(stream_id, staff_id, role)
            VALUES(?,?,?)
            """,
            (stream_id, sid, "stream_senior"),
        )


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
    }
    cache[staff_id] = brief
    return brief


def list_streams() -> List[Dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM training_streams ORDER BY created_at ASC"
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["stream_num_sort"] = db._stream_sort_key(d.get("stream_num") or "") if hasattr(db, "_stream_sort_key") else d.get("stream_num")
        out.append(d)
    # числовая сортировка потоков где возможно
    def sk(x):
        n = re.sub(r"\D+", "", str(x.get("stream_num") or ""))
        return (0, int(n)) if n.isdigit() else (1, str(x.get("stream_num") or ""))

    out.sort(key=sk)
    return out


def list_groups(stream_num: str = "") -> List[Dict[str, Any]]:
    stream_f = db._norm_call(stream_num)
    with db.connect() as conn:
        if stream_f:
            rows = conn.execute(
                """
                SELECT g.*, s.stream_num
                FROM training_groups g
                JOIN training_streams s ON s.id=g.stream_id
                WHERE s.stream_num=?
                ORDER BY g.group_num ASC
                """,
                (stream_f,),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT g.*, s.stream_num
                FROM training_groups g
                JOIN training_streams s ON s.id=g.stream_id
                ORDER BY s.stream_num ASC, g.group_num ASC
                """
            ).fetchall()
        cache: Dict[str, Any] = {}
        enriched = []
        for r in rows:
            d = dict(r)
            d.update(_group_people(conn, d["id"], d["stream_id"], cache))
            cnt = conn.execute(
                "SELECT COUNT(*) AS n FROM cadets WHERE group_id=?", (d["id"],)
            ).fetchone()["n"]
            d["cadets_count"] = int(cnt or 0)
            enriched.append(d)
    return enriched


def _group_people(conn, group_id, stream_id, cache):
    inst = []
    asst = []
    for row in conn.execute(
        "SELECT staff_id, role FROM training_group_staff WHERE group_id=?",
        (group_id,),
    ):
        brief = _staff_brief(row["staff_id"], cache)
        if not brief:
            continue
        if row["role"] == "instructor":
            inst.append(brief)
        elif row["role"] == "assistant":
            asst.append(brief)
    seniors = []
    for row in conn.execute(
        "SELECT staff_id FROM training_stream_staff WHERE stream_id=?",
        (stream_id,),
    ):
        brief = _staff_brief(row["staff_id"], cache)
        if brief:
            seniors.append(brief)
    return {
        "instructors": inst,
        "assistants": asst,
        "stream_seniors": seniors,
    }


def get_group_card(group_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT g.*, s.stream_num, s.note AS stream_note
            FROM training_groups g
            JOIN training_streams s ON s.id=g.stream_id
            WHERE g.id=?
            """,
            (group_id,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        cache: Dict[str, Any] = {}
        d.update(_group_people(conn, d["id"], d["stream_id"], cache))
        cnt = conn.execute(
            "SELECT COUNT(*) AS n FROM cadets WHERE group_id=?", (d["id"],)
        ).fetchone()["n"]
        d["cadets_count"] = int(cnt or 0)
        return d


def enrich_cadets(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Добавляет instructors/assistants/stream_seniors по group_id."""
    gids = sorted({(r.get("group_id") or "").strip() for r in rows if (r.get("group_id") or "").strip()})
    if not gids:
        for r in rows:
            r.setdefault("instructors", [])
            r.setdefault("assistants", [])
            r.setdefault("stream_seniors", [])
        return rows
    people: Dict[str, Dict[str, Any]] = {}
    with db.connect() as conn:
        cache: Dict[str, Any] = {}
        for gid in gids:
            grow = conn.execute(
                "SELECT id, stream_id FROM training_groups WHERE id=?", (gid,)
            ).fetchone()
            if not grow:
                people[gid] = {"instructors": [], "assistants": [], "stream_seniors": []}
                continue
            people[gid] = _group_people(conn, grow["id"], grow["stream_id"], cache)
    for r in rows:
        info = people.get((r.get("group_id") or "").strip()) or {
            "instructors": [],
            "assistants": [],
            "stream_seniors": [],
        }
        r["instructors"] = info.get("instructors") or []
        r["assistants"] = info.get("assistants") or []
        r["stream_seniors"] = info.get("stream_seniors") or []
    return rows


def import_group_row(row: Dict[str, Any]) -> Tuple[str, str, List[str]]:
    """Возвращает (status, group_id, warnings). status: added|updated|skipped."""
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
    with db.connect() as conn:
        existed = conn.execute(
            """
            SELECT g.id FROM training_groups g
            JOIN training_streams s ON s.id=g.stream_id
            WHERE s.stream_num=? AND g.group_num=?
            """,
            (stream, group),
        ).fetchone()
        gid = db.ensure_training_group(
            conn,
            stream,
            group,
            planned_count=planned,
            classroom=row.get("classroom") or "",
            polygon_name=row.get("polygon") or "",
            tent_num=row.get("tent") or "",
            note=row.get("note") or "",
        )
        sid_row = conn.execute(
            "SELECT stream_id FROM training_groups WHERE id=?", (gid,)
        ).fetchone()
        stream_id = sid_row["stream_id"]

        inst_ids = []
        for fio in split_people(row.get("instructor") or ""):
            st = resolve_staff_by_fio(fio)
            if st:
                inst_ids.append(st["id"])
            else:
                warnings.append("Инструктор не найден в штатке: " + fio)
        asst_ids = []
        for fio in split_people(row.get("assistants") or ""):
            st = resolve_staff_by_fio(fio)
            if st:
                asst_ids.append(st["id"])
            else:
                warnings.append("Ассистент не найден в штатке: " + fio)
        senior_ids = []
        for fio in split_people(row.get("seniors") or ""):
            st = resolve_staff_by_fio(fio)
            if st:
                senior_ids.append(st["id"])
            else:
                warnings.append("Старший потока не найден в штатке: " + fio)

        if inst_ids:
            set_group_staff(conn, gid, "instructor", inst_ids[:1])
            if len(inst_ids) > 1:
                # остальных как ассистентов не путаем — предупреждение
                warnings.append("Указано несколько инструкторов — взят первый")
        if asst_ids:
            set_group_staff(conn, gid, "assistant", asst_ids)
        if senior_ids:
            set_stream_seniors(conn, stream_id, senior_ids)
        # note на поток
        note = (row.get("stream_note") or "").strip()
        if note:
            conn.execute(
                "UPDATE training_streams SET note=? WHERE id=? AND trim(COALESCE(note,''))=''",
                (note, stream_id),
            )
    return ("updated" if existed else "added"), gid, warnings
