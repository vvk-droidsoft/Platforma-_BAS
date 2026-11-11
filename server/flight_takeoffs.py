# -*- coding: utf-8 -*-
"""Онлайн-взлёты полётной ведомости (не Excel-сетка flight_sheets)."""
from __future__ import annotations

import json
import uuid
from datetime import date
from typing import Any, Dict, List, Optional, Set

from . import db
from . import tent_assets
from . import flight_sheet

STATUS_ACTIVE = "active"
STATUS_COMPLETED = "completed"
MAX_ACTIVE_PER_GROUP = 2
STATUS_AFTER_OK = (
    tent_assets.STATUS_BG,
    tent_assets.STATUS_NOT_BG,
    tent_assets.STATUS_WRITTEN_OFF,
)


def ensure_tables(conn=None) -> None:
    owns = conn is None
    if owns:
        ctx = db.connect()
        conn = ctx.__enter__()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS flight_takeoffs (
              id TEXT PRIMARY KEY,
              distribution_group_id TEXT NOT NULL DEFAULT '',
              my_group_id TEXT NOT NULL DEFAULT '',
              stream_num TEXT NOT NULL DEFAULT '',
              group_num TEXT NOT NULL DEFAULT '',
              tent_num TEXT NOT NULL DEFAULT '',
              flight_date TEXT NOT NULL DEFAULT '',
              flight_no INTEGER NOT NULL DEFAULT 1,
              takeoff_time TEXT NOT NULL DEFAULT '',
              board_type TEXT NOT NULL DEFAULT '',
              board_number TEXT NOT NULL DEFAULT '',
              board_asset_id TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'active',
              status_after TEXT NOT NULL DEFAULT '',
              created_by TEXT NOT NULL DEFAULT '',
              updated_at TEXT NOT NULL,
              completed_at TEXT NOT NULL DEFAULT '',
              completed_by TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_flight_takeoffs_group_status
              ON flight_takeoffs(distribution_group_id, status);
            CREATE INDEX IF NOT EXISTS idx_flight_takeoffs_date
              ON flight_takeoffs(flight_date, flight_no);
            CREATE TABLE IF NOT EXISTS flight_takeoff_cadets (
              id TEXT PRIMARY KEY,
              takeoff_id TEXT NOT NULL,
              npp INTEGER NOT NULL DEFAULT 0,
              num TEXT NOT NULL DEFAULT '',
              callsign TEXT NOT NULL DEFAULT '',
              fio TEXT NOT NULL DEFAULT '',
              flight_minutes INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY(takeoff_id) REFERENCES flight_takeoffs(id)
            );
            CREATE INDEX IF NOT EXISTS idx_flight_takeoff_cadets_to
              ON flight_takeoff_cadets(takeoff_id, npp);
            CREATE TABLE IF NOT EXISTS flight_takeoff_audit (
              id TEXT PRIMARY KEY,
              takeoff_id TEXT NOT NULL,
              user_id TEXT NOT NULL DEFAULT '',
              action TEXT NOT NULL DEFAULT '',
              diff_json TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              FOREIGN KEY(takeoff_id) REFERENCES flight_takeoffs(id)
            );
            CREATE INDEX IF NOT EXISTS idx_flight_takeoff_audit_to
              ON flight_takeoff_audit(takeoff_id, created_at);
            """
        )
    finally:
        if owns:
            ctx.__exit__(None, None, None)


def _norm(value: Any, limit: int = 120) -> str:
    text = " ".join(str(value or "").replace("\u00a0", " ").split())
    return text[:limit]


def _int_minutes(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    return n if n > 0 else 0


def _actor_id(user: dict) -> str:
    return (user or {}).get("id") or (user or {}).get("staff_id") or ""


def _require_module(user: dict) -> None:
    if not flight_sheet.user_can_use(user):
        raise PermissionError("Блок доступен учётной записи СИ_Тестер")


def visible_group_ids(user: dict) -> Optional[Set[str]]:
    """None = все группы (admin/senior). Пустой set = ничего не видно."""
    role = (user or {}).get("role") or ""
    if role in ("admin", "senior"):
        return None
    staff_id = (user or {}).get("staff_id") or ""
    user_id = (user or {}).get("id") or ""
    ids: Set[str] = set()
    with db.connect() as conn:
        if staff_id:
            for row in conn.execute(
                """
                SELECT group_row_id FROM distribution_group_staff
                WHERE staff_id=? AND role IN ('instructor', 'assistant')
                """,
                (staff_id,),
            ):
                gid = (row["group_row_id"] or "").strip()
                if gid:
                    ids.add(gid)
            for row in conn.execute(
                "SELECT distribution_group_id FROM my_groups WHERE owner_staff_id=?",
                (staff_id,),
            ):
                gid = (row["distribution_group_id"] or "").strip()
                if gid:
                    ids.add(gid)
        elif user_id:
            for row in conn.execute(
                "SELECT distribution_group_id FROM my_groups WHERE owner_user_id=?",
                (user_id,),
            ):
                gid = (row["distribution_group_id"] or "").strip()
                if gid:
                    ids.add(gid)
    return ids


def user_can_view(user: dict, distribution_group_id: str) -> bool:
    role = (user or {}).get("role") or ""
    if role in ("admin", "senior"):
        return True
    if not distribution_group_id:
        return False
    ids = visible_group_ids(user)
    if ids is None:
        return True
    return distribution_group_id in ids


def user_can_edit(user: dict, distribution_group_id: str) -> bool:
    role = (user or {}).get("role") or ""
    if role not in ("instructor", "assistant"):
        return False
    if not distribution_group_id:
        return False
    if tent_assets.user_on_group_staff(user, distribution_group_id):
        return True
    ids = visible_group_ids(user) or set()
    return distribution_group_id in ids


def _add_audit(conn, takeoff_id: str, user: dict, action: str, diff: Any) -> None:
    conn.execute(
        """
        INSERT INTO flight_takeoff_audit(id, takeoff_id, user_id, action, diff_json, created_at)
        VALUES(?,?,?,?,?,?)
        """,
        (
            uuid.uuid4().hex,
            takeoff_id,
            _actor_id(user),
            action,
            json.dumps(diff if diff is not None else {}, ensure_ascii=False),
            db._now(),
        ),
    )


def _load_cadets(conn, takeoff_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, npp, num, callsign, fio, flight_minutes
        FROM flight_takeoff_cadets
        WHERE takeoff_id=?
        ORDER BY npp ASC, rowid ASC
        """,
        (takeoff_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _replace_cadets(conn, takeoff_id: str, cadets: List[Dict[str, Any]]) -> None:
    conn.execute("DELETE FROM flight_takeoff_cadets WHERE takeoff_id=?", (takeoff_id,))
    for i, raw in enumerate(cadets or [], 1):
        conn.execute(
            """
            INSERT INTO flight_takeoff_cadets(
              id, takeoff_id, npp, num, callsign, fio, flight_minutes
            ) VALUES(?,?,?,?,?,?,?)
            """,
            (
                _norm(raw.get("id"), 64) or uuid.uuid4().hex,
                takeoff_id,
                int(raw.get("npp") or i),
                _norm(raw.get("num"), 64),
                _norm(raw.get("callsign"), 80),
                _norm(raw.get("fio"), 160),
                _int_minutes(raw.get("flight_minutes")),
            ),
        )


def _takeoff_out(row, cadets: List[Dict[str, Any]], user: dict) -> Dict[str, Any]:
    d = dict(row)
    asset_id = (d.get("board_asset_id") or "").strip()
    live_status = ""
    live_type = d.get("board_type") or ""
    live_num = d.get("board_number") or ""
    if asset_id:
        asset = tent_assets.get_asset(asset_id)
        if asset:
            live_status = asset.get("status") or ""
            live_type = asset.get("board_type") or live_type
            live_num = asset.get("board_num") or live_num
            d["board_status_label"] = asset.get("status_label") or tent_assets.status_label(live_status)
        else:
            d["board_status_label"] = tent_assets.status_label(d.get("status_after") or "")
    else:
        d["board_status_label"] = tent_assets.status_label(d.get("status_after") or "")
    d["board_status"] = live_status
    d["board_type"] = live_type
    d["board_number"] = live_num
    d["cadets"] = cadets
    d["minutes_total"] = sum(_int_minutes(c.get("flight_minutes")) for c in cadets)
    d["cadets_count"] = len(cadets)
    gid = d.get("distribution_group_id") or ""
    d["can_edit"] = bool(
        d.get("status") == STATUS_ACTIVE and user_can_edit(user, gid)
    )
    d["status_after_label"] = tent_assets.status_label(d.get("status_after") or "")
    return d


def get_takeoff(takeoff_id: str, user: dict) -> Optional[Dict[str, Any]]:
    if not takeoff_id:
        return None
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM flight_takeoffs WHERE id=?", (takeoff_id,)
        ).fetchone()
        if not row:
            return None
        cadets = _load_cadets(conn, takeoff_id)
    d = _takeoff_out(row, cadets, user)
    if not user_can_view(user, d.get("distribution_group_id") or ""):
        return None
    return d


def list_takeoffs(user: dict) -> List[Dict[str, Any]]:
    ids = visible_group_ids(user)
    with db.connect() as conn:
        if ids is None:
            rows = conn.execute(
                """
                SELECT * FROM flight_takeoffs
                ORDER BY flight_date DESC, flight_no ASC, updated_at DESC
                """
            ).fetchall()
        elif not ids:
            rows = []
        else:
            marks = ",".join("?" * len(ids))
            rows = conn.execute(
                f"""
                SELECT * FROM flight_takeoffs
                WHERE distribution_group_id IN ({marks})
                ORDER BY flight_date DESC, flight_no ASC, updated_at DESC
                """,
                tuple(ids),
            ).fetchall()
        packed = [(dict(row), _load_cadets(conn, row["id"])) for row in rows]
    return [_takeoff_out(row, cadets, user) for row, cadets in packed]


def _count_active(conn, distribution_group_id: str, *, exclude_id: str = "") -> int:
    if exclude_id:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c FROM flight_takeoffs
            WHERE distribution_group_id=? AND status=? AND id<>?
            """,
            (distribution_group_id, STATUS_ACTIVE, exclude_id),
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT COUNT(*) AS c FROM flight_takeoffs
            WHERE distribution_group_id=? AND status=?
            """,
            (distribution_group_id, STATUS_ACTIVE),
        ).fetchone()
    return int(row["c"] or 0)


def _next_flight_no(conn, distribution_group_id: str, flight_date: str) -> int:
    row = conn.execute(
        """
        SELECT MAX(flight_no) AS m FROM flight_takeoffs
        WHERE distribution_group_id=? AND flight_date=?
        """,
        (distribution_group_id, flight_date),
    ).fetchone()
    return int(row["m"] or 0) + 1


def _resolve_group(user: dict, body: Dict[str, Any]) -> Dict[str, str]:
    dist_id = _norm(body.get("distribution_group_id"), 64)
    my_id = _norm(body.get("my_group_id"), 64)
    stream_num = _norm(body.get("stream_num"), 32)
    group_num = _norm(body.get("group_num"), 32)
    tent_num = ""
    if my_id:
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM my_groups WHERE id=?", (my_id,)).fetchone()
        if row:
            dist_id = dist_id or (row["distribution_group_id"] or "")
            stream_num = stream_num or (row["stream_num"] or "")
            group_num = group_num or (row["group_num"] or "")
            tent_num = row["tent_num"] or ""
    if not dist_id and stream_num and group_num:
        with db.connect() as conn:
            staff_id = (user or {}).get("staff_id") or ""
            user_id = (user or {}).get("id") or ""
            row = None
            if staff_id:
                row = conn.execute(
                    """
                    SELECT * FROM my_groups
                    WHERE owner_staff_id=? AND stream_num=? AND group_num=?
                    ORDER BY created_at DESC
                    """,
                    (staff_id, stream_num, group_num),
                ).fetchone()
            if not row and user_id:
                row = conn.execute(
                    """
                    SELECT * FROM my_groups
                    WHERE owner_user_id=? AND stream_num=? AND group_num=?
                    ORDER BY created_at DESC
                    """,
                    (user_id, stream_num, group_num),
                ).fetchone()
            if row:
                dist_id = row["distribution_group_id"] or ""
                my_id = my_id or row["id"]
                tent_num = row["tent_num"] or ""
    if not dist_id:
        raise ValueError("Не выбрана группа для взлёта")
    group = tent_assets.get_group(dist_id)
    if group:
        tent_num = tent_num or (group.get("tent_num") or "")
        stream_num = stream_num or (group.get("stream_num") or "")
        group_num = group_num or (group.get("group_num") or "")
    return {
        "distribution_group_id": dist_id,
        "my_group_id": my_id,
        "stream_num": stream_num,
        "group_num": group_num,
        "tent_num": tent_num,
    }


class LimitError(ValueError):
    def __init__(self, message: str, active_ids: Optional[List[str]] = None):
        super().__init__(message)
        self.active_ids = active_ids or []


def create_takeoff(user: dict, body: Dict[str, Any]) -> Dict[str, Any]:
    _require_module(user)
    meta = _resolve_group(user, body)
    gid = meta["distribution_group_id"]
    if not user_can_edit(user, gid):
        raise PermissionError("Редактировать взлёты могут только инструктор и ассистент этой палатки")
    flight_date = _norm(body.get("flight_date"), 16) or date.today().isoformat()
    takeoff_time = _norm(body.get("takeoff_time"), 8)
    board_asset_id = _norm(body.get("board_asset_id"), 64)
    board_type = _norm(body.get("board_type"), 80)
    board_number = _norm(body.get("board_number"), 64)
    tid = uuid.uuid4().hex
    now = db._now()
    with db.connect() as conn:
        if _count_active(conn, gid) >= MAX_ACTIVE_PER_GROUP:
            rows = conn.execute(
                """
                SELECT id FROM flight_takeoffs
                WHERE distribution_group_id=? AND status=?
                ORDER BY flight_date, flight_no
                """,
                (gid, STATUS_ACTIVE),
            ).fetchall()
            raise LimitError(
                "В группе уже два незавершённых взлёта. Завершите один из них, чтобы добавить следующий.",
                [r["id"] for r in rows],
            )
        flight_no = int(body.get("flight_no") or 0)
        if flight_no < 1:
            flight_no = _next_flight_no(conn, gid, flight_date)
        conn.execute(
            """
            INSERT INTO flight_takeoffs(
              id, distribution_group_id, my_group_id, stream_num, group_num, tent_num,
              flight_date, flight_no, takeoff_time, board_type, board_number, board_asset_id,
              status, status_after, created_by, updated_at, completed_at, completed_by
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                tid,
                gid,
                meta["my_group_id"],
                meta["stream_num"],
                meta["group_num"],
                meta["tent_num"],
                flight_date,
                flight_no,
                takeoff_time,
                board_type,
                board_number,
                board_asset_id,
                STATUS_ACTIVE,
                "",
                _actor_id(user),
                now,
                "",
                "",
            ),
        )
        _replace_cadets(conn, tid, body.get("cadets") or [])
        _add_audit(conn, tid, user, "create", {"flight_date": flight_date, "flight_no": flight_no})
    return get_takeoff(tid, user)


def _snapshot(row, cadets) -> Dict[str, Any]:
    return {
        "distribution_group_id": row["distribution_group_id"],
        "my_group_id": row["my_group_id"],
        "stream_num": row["stream_num"],
        "group_num": row["group_num"],
        "flight_date": row["flight_date"],
        "flight_no": row["flight_no"],
        "takeoff_time": row["takeoff_time"],
        "board_type": row["board_type"],
        "board_number": row["board_number"],
        "board_asset_id": row["board_asset_id"],
        "cadets": [
            {
                "npp": c.get("npp"),
                "num": c.get("num"),
                "callsign": c.get("callsign"),
                "flight_minutes": c.get("flight_minutes"),
            }
            for c in cadets
        ],
    }


def update_takeoff(user: dict, takeoff_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    _require_module(user)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM flight_takeoffs WHERE id=?", (takeoff_id,)
        ).fetchone()
        if not row:
            raise KeyError("Взлёт не найден")
        if row["status"] != STATUS_ACTIVE:
            raise PermissionError("Завершённый взлёт нельзя изменять")
        gid = row["distribution_group_id"]
        if not user_can_edit(user, gid):
            raise PermissionError("Редактировать взлёты могут только инструктор и ассистент этой палатки")
        before = _snapshot(row, _load_cadets(conn, takeoff_id))
        merged = dict(row)
        for key, val in (body or {}).items():
            if val is None or val == "":
                continue
            merged[key] = val
        meta = _resolve_group(user, merged)
        new_gid = meta["distribution_group_id"] or gid
        if new_gid != gid and not user_can_edit(user, new_gid):
            raise PermissionError("Нельзя перенести взлёт в чужую группу")
        if new_gid != gid and _count_active(conn, new_gid, exclude_id=takeoff_id) >= MAX_ACTIVE_PER_GROUP:
            raise LimitError(
                "В выбранной группе уже два незавершённых взлёта.",
            )
        flight_date = _norm(body.get("flight_date"), 16) or row["flight_date"]
        try:
            flight_no = int(body.get("flight_no") if body.get("flight_no") is not None else row["flight_no"])
        except (TypeError, ValueError):
            flight_no = row["flight_no"]
        if flight_no < 1:
            flight_no = 1
        takeoff_time = _norm(body.get("takeoff_time"), 8) if "takeoff_time" in body else row["takeoff_time"]
        board_asset_id = (
            _norm(body.get("board_asset_id"), 64)
            if "board_asset_id" in body
            else row["board_asset_id"]
        )
        board_type = _norm(body.get("board_type"), 80) if "board_type" in body else row["board_type"]
        board_number = (
            _norm(body.get("board_number"), 64) if "board_number" in body else row["board_number"]
        )
        conn.execute(
            """
            UPDATE flight_takeoffs SET
              distribution_group_id=?, my_group_id=?, stream_num=?, group_num=?, tent_num=?,
              flight_date=?, flight_no=?, takeoff_time=?, board_type=?, board_number=?,
              board_asset_id=?, updated_at=?
            WHERE id=?
            """,
            (
                new_gid,
                meta["my_group_id"] or row["my_group_id"],
                meta["stream_num"] or row["stream_num"],
                meta["group_num"] or row["group_num"],
                meta["tent_num"] or row["tent_num"],
                flight_date,
                flight_no,
                takeoff_time,
                board_type,
                board_number,
                board_asset_id,
                db._now(),
                takeoff_id,
            ),
        )
        if "cadets" in body:
            _replace_cadets(conn, takeoff_id, body.get("cadets") or [])
        after_cadets = _load_cadets(conn, takeoff_id)
        after_row = conn.execute(
            "SELECT * FROM flight_takeoffs WHERE id=?", (takeoff_id,)
        ).fetchone()
        after = _snapshot(after_row, after_cadets)
        if after != before:
            _add_audit(conn, takeoff_id, user, "update", {"before": before, "after": after})
    return get_takeoff(takeoff_id, user)


def delete_takeoff(user: dict, takeoff_id: str) -> bool:
    _require_module(user)
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM flight_takeoffs WHERE id=?", (takeoff_id,)
        ).fetchone()
        if not row:
            return False
        if row["status"] != STATUS_ACTIVE:
            raise PermissionError("Завершённый взлёт нельзя удалить")
        if not user_can_edit(user, row["distribution_group_id"]):
            raise PermissionError("Редактировать взлёты могут только инструктор и ассистент этой палатки")
        _add_audit(conn, takeoff_id, user, "delete", _snapshot(row, _load_cadets(conn, takeoff_id)))
        conn.execute("DELETE FROM flight_takeoff_cadets WHERE takeoff_id=?", (takeoff_id,))
        conn.execute("DELETE FROM flight_takeoffs WHERE id=?", (takeoff_id,))
    return True


def complete_takeoff(user: dict, takeoff_id: str, status_after: str) -> Dict[str, Any]:
    _require_module(user)
    target = tent_assets._norm_status(status_after)
    if target not in STATUS_AFTER_OK:
        raise ValueError("Укажите статус борта после полёта: БГ, НЕ БГ или Утерян")
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM flight_takeoffs WHERE id=?", (takeoff_id,)
        ).fetchone()
        if not row:
            raise KeyError("Взлёт не найден")
        snapshot = dict(row)
    if snapshot["status"] != STATUS_ACTIVE:
        raise PermissionError("Взлёт уже завершён")
    if not user_can_edit(user, snapshot["distribution_group_id"]):
        raise PermissionError("Завершать взлёт могут только инструктор и ассистент этой палатки")
    asset_id = (snapshot["board_asset_id"] or "").strip()
    if not asset_id:
        raise ValueError("Сначала выберите борт")
    asset = tent_assets.get_asset(asset_id)
    if not asset:
        raise ValueError("Борт не найден")
    changed_by = _actor_id(user)
    current = asset.get("status") or ""
    if target == tent_assets.STATUS_WRITTEN_OFF:
        if current != tent_assets.STATUS_WRITTEN_OFF:
            raise ValueError("Для статуса «Утерян» сначала оформите акт списания")
    elif current != target:
        tent_assets.set_status(asset_id, target, note="Завершение полёта", changed_by=changed_by)
    now = db._now()
    with db.connect() as conn:
        conn.execute(
            """
            UPDATE flight_takeoffs
            SET status=?, status_after=?, completed_at=?, completed_by=?, updated_at=?
            WHERE id=? AND status=?
            """,
            (STATUS_COMPLETED, target, now, changed_by, now, takeoff_id, STATUS_ACTIVE),
        )
        _add_audit(
            conn,
            takeoff_id,
            user,
            "complete",
            {"status_after": target, "board_asset_id": asset_id},
        )
    return get_takeoff(takeoff_id, user)
