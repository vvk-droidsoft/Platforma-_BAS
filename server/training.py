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


def list_streams_summary() -> List[Dict[str, Any]]:
    """Потоки со сводками групп/курсантов/состава для справочника."""
    streams = list_streams()
    groups = list_groups()
    by_sid: Dict[str, List[Dict[str, Any]]] = {}
    for g in groups:
        by_sid.setdefault(g.get("stream_id") or "", []).append(g)
    for s in streams:
        gs = by_sid.get(s["id"], [])
        seniors = (gs[0].get("stream_seniors") if gs else []) or []
        s["stream_seniors"] = seniors
        s["groups_count"] = len(gs)
        s["cadets_count"] = sum(int(g.get("cadets_count") or 0) for g in gs)
        s["staff_count"] = _unique_staff_count(
            seniors,
            *[g.get("instructors") or [] for g in gs],
            *[g.get("assistants") or [] for g in gs],
        )
        s["groups"] = gs
    return streams


def get_stream(stream_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM training_streams WHERE id=?", (stream_id,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    for s in list_streams_summary():
        if s["id"] == stream_id:
            return s
    d["groups"] = list_groups(d.get("stream_num") or "")
    d["groups_count"] = len(d["groups"])
    d["cadets_count"] = sum(int(g.get("cadets_count") or 0) for g in d["groups"])
    return d


def create_stream(stream_num: str, note: str = "") -> Dict[str, Any]:
    stream = db._norm_call(stream_num)
    if not stream:
        raise ValueError("Укажите номер потока")
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT id FROM training_streams WHERE stream_num=?", (stream,)
        ).fetchone()
        if exists:
            raise ValueError("Поток с таким номером уже есть")
        sid = db.ensure_training_stream(conn, stream, note=note or "")
    return get_stream(sid) or {"id": sid, "stream_num": stream}


def update_stream(
    stream_id: str,
    *,
    stream_num: Optional[str] = None,
    note: Optional[str] = None,
    seniors_text: Optional[str] = None,
) -> Dict[str, Any]:
    cur = get_stream(stream_id)
    if not cur:
        raise ValueError("Поток не найден")
    warnings: List[str] = []
    with db.connect() as conn:
        if stream_num is not None:
            new_num = db._norm_call(stream_num)
            if not new_num:
                raise ValueError("Укажите номер потока")
            clash = conn.execute(
                "SELECT id FROM training_streams WHERE stream_num=? AND id!=?",
                (new_num, stream_id),
            ).fetchone()
            if clash:
                raise ValueError("Поток с таким номером уже есть")
            conn.execute(
                "UPDATE training_streams SET stream_num=? WHERE id=?",
                (new_num, stream_id),
            )
        if note is not None:
            conn.execute(
                "UPDATE training_streams SET note=? WHERE id=?",
                ((note or "").strip(), stream_id),
            )
        if seniors_text is not None:
            senior_ids = []
            for fio in split_people(seniors_text):
                st = resolve_staff_by_fio(fio)
                if st:
                    senior_ids.append(st["id"])
                else:
                    warnings.append("Старший потока не найден в штатке: " + fio)
            set_stream_seniors(conn, stream_id, senior_ids)
    out = get_stream(stream_id)
    if out is not None:
        out["warnings"] = warnings
    return out or cur


def delete_stream(stream_id: str, *, force_empty_groups: bool = True) -> Dict[str, Any]:
    """Удаляет поток. Группы с курсантами — блок. Пустые группы — удаляются при force."""
    cur = get_stream(stream_id)
    if not cur:
        raise ValueError("Поток не найден")
    groups = cur.get("groups") or list_groups(cur.get("stream_num") or "")
    with_cadets = [g for g in groups if int(g.get("cadets_count") or 0) > 0]
    if with_cadets:
        raise ValueError(
            "В потоке есть группы с курсантами ("
            + ", ".join(g.get("group_num") or "?" for g in with_cadets)
            + "). Сначала удалите или отвяжите курсантов."
        )
    empty = [g for g in groups if int(g.get("cadets_count") or 0) == 0]
    if empty and not force_empty_groups:
        raise ValueError(
            "В потоке есть пустые группы: "
            + ", ".join(g.get("group_num") or "?" for g in empty)
            + ". Удалите их или подтвердите удаление потока."
        )
    with db.connect() as conn:
        for g in empty:
            conn.execute(
                "DELETE FROM training_group_staff WHERE group_id=?", (g["id"],)
            )
            conn.execute("DELETE FROM training_groups WHERE id=?", (g["id"],))
        conn.execute(
            "DELETE FROM training_stream_staff WHERE stream_id=?", (stream_id,)
        )
        conn.execute("DELETE FROM training_streams WHERE id=?", (stream_id,))
    return {"ok": True, "deleted_groups": len(empty)}


def create_group(
    *,
    stream_num: str = "",
    stream_id: str = "",
    group_num: str = "",
    planned_count: int = 0,
    classroom: str = "",
    polygon_name: str = "",
    tent_num: str = "",
    note: str = "",
    instructor_text: str = "",
    assistants_text: str = "",
) -> Tuple[Dict[str, Any], List[str]]:
    warnings: List[str] = []
    group = db._norm_call(group_num)
    if not group:
        raise ValueError("Укажите номер группы")
    stream = db._norm_call(stream_num)
    with db.connect() as conn:
        if stream_id:
            srow = conn.execute(
                "SELECT id, stream_num FROM training_streams WHERE id=?",
                (stream_id,),
            ).fetchone()
            if not srow:
                raise ValueError("Поток не найден")
            stream = srow["stream_num"]
            sid = srow["id"]
        else:
            if not stream:
                raise ValueError("Укажите поток")
            sid = db.ensure_training_stream(conn, stream)
        exists = conn.execute(
            "SELECT id FROM training_groups WHERE stream_id=? AND group_num=?",
            (sid, group),
        ).fetchone()
        if exists:
            raise ValueError("Группа с таким номером в потоке уже есть")
        gid = db.ensure_training_group(
            conn,
            stream,
            group,
            planned_count=planned_count,
            classroom=classroom,
            polygon_name=polygon_name,
            tent_num=tent_num,
            note=note,
        )
        # ensure_training_group при существовании дополняет — но мы проверили exists
        warnings.extend(_apply_group_staff_text(conn, gid, instructor_text, assistants_text))
    card = get_group_card(gid)
    return card or {"id": gid}, warnings


def update_group(
    group_id: str,
    *,
    group_num: Optional[str] = None,
    planned_count: Optional[int] = None,
    classroom: Optional[str] = None,
    polygon_name: Optional[str] = None,
    tent_num: Optional[str] = None,
    note: Optional[str] = None,
    instructor_text: Optional[str] = None,
    assistants_text: Optional[str] = None,
) -> Tuple[Dict[str, Any], List[str]]:
    cur = get_group_card(group_id)
    if not cur:
        raise ValueError("Группа не найдена")
    warnings: List[str] = []
    with db.connect() as conn:
        if group_num is not None:
            new_g = db._norm_call(group_num)
            if not new_g:
                raise ValueError("Укажите номер группы")
            clash = conn.execute(
                """
                SELECT id FROM training_groups
                WHERE stream_id=? AND group_num=? AND id!=?
                """,
                (cur["stream_id"], new_g, group_id),
            ).fetchone()
            if clash:
                raise ValueError("Группа с таким номером в потоке уже есть")
            conn.execute(
                "UPDATE training_groups SET group_num=? WHERE id=?",
                (new_g, group_id),
            )
            # синхронизируем денормализованное поле у курсантов
            conn.execute(
                "UPDATE cadets SET group_num=? WHERE group_id=?",
                (new_g, group_id),
            )
        fields = []
        vals: List[Any] = []
        if planned_count is not None:
            fields.append("planned_count=?")
            vals.append(int(planned_count or 0))
        if classroom is not None:
            fields.append("classroom=?")
            vals.append((classroom or "").strip())
        if polygon_name is not None:
            fields.append("polygon_name=?")
            vals.append((polygon_name or "").strip())
        if tent_num is not None:
            fields.append("tent_num=?")
            vals.append((tent_num or "").strip())
        if note is not None:
            fields.append("note=?")
            vals.append((note or "").strip())
        if fields:
            vals.append(group_id)
            conn.execute(
                "UPDATE training_groups SET " + ", ".join(fields) + " WHERE id=?",
                vals,
            )
        if instructor_text is not None or assistants_text is not None:
            inst = instructor_text if instructor_text is not None else None
            asst = assistants_text if assistants_text is not None else None
            # если передали только одно поле — второе не трогаем
            if inst is not None:
                warnings.extend(_apply_group_staff_text(conn, group_id, inst, None, only="instructor"))
            if asst is not None:
                warnings.extend(_apply_group_staff_text(conn, group_id, None, asst, only="assistant"))
    card = get_group_card(group_id)
    return card or cur, warnings


def _apply_group_staff_text(
    conn,
    group_id: str,
    instructor_text: Optional[str],
    assistants_text: Optional[str],
    only: str = "",
) -> List[str]:
    warnings: List[str] = []
    if only in ("", "instructor") and instructor_text is not None:
        inst_ids = []
        for fio in split_people(instructor_text):
            st = resolve_staff_by_fio(fio)
            if st:
                inst_ids.append(st["id"])
            else:
                warnings.append("Инструктор не найден в штатке: " + fio)
        set_group_staff(conn, group_id, "instructor", inst_ids[:1])
        if len(inst_ids) > 1:
            warnings.append("Указано несколько инструкторов — взят первый")
    if only in ("", "assistant") and assistants_text is not None:
        asst_ids = []
        for fio in split_people(assistants_text):
            st = resolve_staff_by_fio(fio)
            if st:
                asst_ids.append(st["id"])
            else:
                warnings.append("Ассистент не найден в штатке: " + fio)
        set_group_staff(conn, group_id, "assistant", asst_ids)
    return warnings


def delete_group(group_id: str, *, detach_cadets: bool = False) -> Dict[str, Any]:
    card = get_group_card(group_id)
    if not card:
        raise ValueError("Группа не найдена")
    n = int(card.get("cadets_count") or 0)
    with db.connect() as conn:
        if n > 0 and not detach_cadets:
            raise ValueError(
                "В группе есть курсанты ("
                + str(n)
                + "). Удалите их или подтвердите отвязку от группы."
            )
        if n > 0 and detach_cadets:
            conn.execute(
                "UPDATE cadets SET group_id=NULL WHERE group_id=?",
                (group_id,),
            )
        conn.execute(
            "DELETE FROM training_group_staff WHERE group_id=?", (group_id,)
        )
        conn.execute("DELETE FROM training_groups WHERE id=?", (group_id,))
    return {"ok": True, "detached_cadets": n if detach_cadets else 0}


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


def _unique_staff_count(*lists: List[Dict[str, Any]]) -> int:
    ids = set()
    for lst in lists:
        for p in lst or []:
            sid = (p or {}).get("id")
            if sid:
                ids.add(sid)
    return len(ids)


def _group_num_sort(group_num: str):
    n = re.sub(r"\D+", "", str(group_num or ""))
    return (0, int(n)) if n.isdigit() else (1, str(group_num or ""))


def build_tree(cadets: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Дерево поток → группы → курсанты + сводки и блок «Без привязки»."""
    cadets = list(cadets if cadets is not None else enrich_cadets(db.list_cadets()))
    by_group: Dict[str, List[Dict[str, Any]]] = {}
    orphans: List[Dict[str, Any]] = []
    for c in cadets:
        gid = (c.get("group_id") or "").strip()
        if gid:
            by_group.setdefault(gid, []).append(c)
        else:
            orphans.append(c)

    streams_out: List[Dict[str, Any]] = []
    groups = list_groups()
    by_stream: Dict[str, List[Dict[str, Any]]] = {}
    for g in groups:
        by_stream.setdefault(g["stream_id"], []).append(g)

    for s in list_streams():
        stream_groups = []
        stream_staff_lists: List[List[Dict[str, Any]]] = []
        seniors: List[Dict[str, Any]] = []
        cadets_total = 0
        for g in sorted(by_stream.get(s["id"]) or [], key=lambda x: _group_num_sort(x.get("group_num") or "")):
            glist = by_group.pop(g["id"], [])
            # порядок внутри группы — по seq/npp
            glist.sort(key=lambda x: (int(x.get("npp") or 0), str(x.get("student_num") or "")))
            inst = g.get("instructors") or []
            asst = g.get("assistants") or []
            if not seniors and (g.get("stream_seniors") or []):
                seniors = list(g.get("stream_seniors") or [])
            staff_n = _unique_staff_count(inst, asst)
            stream_staff_lists.append(inst)
            stream_staff_lists.append(asst)
            cadets_total += len(glist)
            stream_groups.append(
                {
                    "id": g["id"],
                    "group_num": g.get("group_num") or "",
                    "planned_count": int(g.get("planned_count") or 0),
                    "classroom": g.get("classroom") or "",
                    "polygon_name": g.get("polygon_name") or "",
                    "tent_num": g.get("tent_num") or "",
                    "note": g.get("note") or "",
                    "instructors": inst,
                    "assistants": asst,
                    "cadets_count": len(glist),
                    "staff_count": staff_n,
                    "cadets": glist,
                }
            )
        stream_staff_lists.append(seniors)
        streams_out.append(
            {
                "id": s["id"],
                "stream_num": s.get("stream_num") or "",
                "note": s.get("note") or "",
                "stream_seniors": seniors,
                "groups_count": len(stream_groups),
                "cadets_count": cadets_total,
                "staff_count": _unique_staff_count(*stream_staff_lists),
                "groups": stream_groups,
            }
        )

    # группы без записи в streams уже покрыты list_streams+list_groups;
    # курсанты с group_id на удалённую группу → orphans
    for leftover in by_group.values():
        orphans.extend(leftover)
    orphans.sort(key=lambda x: (int(x.get("npp") or 0), str(x.get("student_num") or "")))

    return {
        "streams": streams_out,
        "orphans": orphans,
        "totals": {
            "streams": len(streams_out),
            "groups": sum(s["groups_count"] for s in streams_out),
            "cadets": sum(s["cadets_count"] for s in streams_out) + len(orphans),
            "orphans": len(orphans),
        },
    }


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
