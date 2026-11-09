# -*- coding: utf-8 -*-
"""CRUD и apply для сущности «Распределение полигонов»."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from . import db
from .polygon_source import parse_polygon_docx


def _norm_group(s: str) -> str:
    t = (s or "").strip()
    if t.isdigit():
        return str(int(t))
    return t


def _norm_stream(s: str) -> str:
    return (s or "").strip().replace(",", ".")


def list_assignments(dist_id: str) -> List[Dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM polygon_assignments
            WHERE distribution_id=?
            ORDER BY created_at DESC
            """,
            (dist_id,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["streams"] = [
                x["stream_num"]
                for x in conn.execute(
                    """
                    SELECT stream_num FROM polygon_assignment_streams
                    WHERE assignment_id=? ORDER BY stream_num
                    """,
                    (d["id"],),
                )
            ]
            d["rows_count"] = conn.execute(
                "SELECT COUNT(*) AS c FROM polygon_assignment_rows WHERE assignment_id=?",
                (d["id"],),
            ).fetchone()["c"]
            out.append(d)
    return out


def get_assignment(dist_id: str, assignment_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM polygon_assignments
            WHERE id=? AND distribution_id=?
            """,
            (assignment_id, dist_id),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["streams"] = [
            x["stream_num"]
            for x in conn.execute(
                """
                SELECT stream_num FROM polygon_assignment_streams
                WHERE assignment_id=? ORDER BY stream_num
                """,
                (assignment_id,),
            )
        ]
        d["rows"] = [
            dict(x)
            for x in conn.execute(
                """
                SELECT * FROM polygon_assignment_rows
                WHERE assignment_id=?
                ORDER BY stream_num, CAST(group_num AS INTEGER), group_num
                """,
                (assignment_id,),
            )
        ]
        d["seniors"] = [
            dict(x)
            for x in conn.execute(
                """
                SELECT * FROM polygon_seniors
                WHERE assignment_id=?
                ORDER BY polygon_name, rowid
                """,
                (assignment_id,),
            )
        ]
    return d


def preview_import(
    dist_id: str,
    raw: bytes,
    *,
    filename: str = "",
    year: Optional[int] = None,
) -> Dict[str, Any]:
    parsed = parse_polygon_docx(raw, filename=filename, year=year)
    return enrich_preview(dist_id, parsed)


def enrich_preview(dist_id: str, parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Матч строк к группам открытого распределения."""
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT id, title FROM distributions WHERE id=?", (dist_id,)
        ).fetchone()
        if not exists:
            raise ValueError("Распределение не найдено")
        groups = conn.execute(
            """
            SELECT id, stream_num, group_num, polygon_name
            FROM distribution_groups
            WHERE distribution_id=?
            """,
            (dist_id,),
        ).fetchall()
    by_key = {
        (_norm_stream(g["stream_num"]), _norm_group(g["group_num"])): dict(g)
        for g in groups
    }
    # если в файле один поток и в dist тоже есть — подставим
    file_streams = [_norm_stream(s) for s in (parsed.get("streams") or []) if s]
    matched = []
    missing = []
    for r in parsed.get("rows") or []:
        sn = _norm_stream(r.get("stream") or "")
        gn = _norm_group(r.get("group") or "")
        if not sn and len(file_streams) == 1:
            sn = file_streams[0]
        if not sn:
            # попробовать найти группу только по номеру, если уникальна
            cands = [g for k, g in by_key.items() if k[1] == gn]
            if len(cands) == 1:
                sn = _norm_stream(cands[0]["stream_num"])
        key = (sn, gn)
        g = by_key.get(key)
        item = {
            **r,
            "stream": sn,
            "group": gn,
            "group_row_id": (g["id"] if g else "") or "",
            "found": bool(g),
            "current_polygon": (g.get("polygon_name") if g else "") or "",
        }
        matched.append(item)
        if not g:
            missing.append({"stream": sn, "group": gn, "polygon": r.get("polygon")})

    out = dict(parsed)
    out["distribution_id"] = dist_id
    out["distribution_title"] = exists["title"] if exists else ""
    out["rows"] = matched
    out["missing_groups"] = missing
    out["stats"] = dict(parsed.get("stats") or {})
    out["stats"]["matched"] = sum(1 for x in matched if x["found"])
    out["stats"]["missing"] = len(missing)
    return out


def apply_import(
    dist_id: str,
    raw: bytes,
    *,
    filename: str = "",
    year: Optional[int] = None,
    created_by: str = None,
) -> Dict[str, Any]:
    preview = preview_import(dist_id, raw, filename=filename, year=year)
    aid = uuid.uuid4().hex
    title = (preview.get("title") or "").strip() or "Распределение полигонов"
    period_from = preview.get("period_from") or ""
    period_to = preview.get("period_to") or ""
    streams = sorted(
        {
            _norm_stream(s)
            for s in (preview.get("streams") or [])
            if _norm_stream(s)
        }
        | {_norm_stream(r.get("stream") or "") for r in preview.get("rows") or [] if r.get("stream")}
    )

    updated = 0
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO polygon_assignments(
              id, distribution_id, title, period_from, period_to,
              source_filename, created_at, created_by
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                aid,
                dist_id,
                title,
                period_from,
                period_to,
                filename or "",
                db._now(),
                created_by,
            ),
        )
        for sn in streams:
            conn.execute(
                """
                INSERT OR IGNORE INTO polygon_assignment_streams(assignment_id, stream_num)
                VALUES(?,?)
                """,
                (aid, sn),
            )
        for r in preview.get("rows") or []:
            rid = uuid.uuid4().hex
            gid = r.get("group_row_id") or ""
            poly = (r.get("polygon") or "").strip()
            conn.execute(
                """
                INSERT INTO polygon_assignment_rows(
                  id, assignment_id, stream_num, group_num, polygon_name,
                  organization, group_row_id
                ) VALUES(?,?,?,?,?,?,?)
                """,
                (
                    rid,
                    aid,
                    r.get("stream") or "",
                    r.get("group") or "",
                    poly,
                    r.get("organization") or "",
                    gid,
                ),
            )
            if gid and poly:
                conn.execute(
                    "UPDATE distribution_groups SET polygon_name=? WHERE id=?",
                    (poly, gid),
                )
                conn.execute(
                    """
                    UPDATE my_groups SET polygon_name=?
                    WHERE distribution_group_id=?
                    """,
                    (poly, gid),
                )
                # также по поток+группа на случай старых копий
                conn.execute(
                    """
                    UPDATE my_groups SET polygon_name=?
                    WHERE distribution_id=? AND stream_num=? AND group_num=?
                    """,
                    (
                        poly,
                        dist_id,
                        r.get("stream") or "",
                        r.get("group") or "",
                    ),
                )
                updated += 1

        for block in preview.get("seniors") or []:
            poly = (block.get("polygon") or "").strip()
            people = block.get("people") or []
            if block.get("empty") and not people:
                conn.execute(
                    """
                    INSERT INTO polygon_seniors(
                      id, assignment_id, polygon_name, staff_id, fio_raw
                    ) VALUES(?,?,?,?,?)
                    """,
                    (uuid.uuid4().hex, aid, poly, "", ""),
                )
                continue
            for p in people:
                conn.execute(
                    """
                    INSERT INTO polygon_seniors(
                      id, assignment_id, polygon_name, staff_id, fio_raw
                    ) VALUES(?,?,?,?,?)
                    """,
                    (
                        uuid.uuid4().hex,
                        aid,
                        poly,
                        p.get("id") or "",
                        p.get("query") or p.get("fio") or "",
                    ),
                )

    card = get_assignment(dist_id, aid)
    return {
        "ok": True,
        "dry_run": False,
        "assignment": card,
        "updated_groups": updated,
        "missing_groups": preview.get("missing_groups") or [],
        "unmatched_staff": preview.get("unmatched_staff") or [],
        "warnings": preview.get("warnings") or [],
        "stats": preview.get("stats") or {},
    }
