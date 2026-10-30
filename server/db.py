# -*- coding: utf-8 -*-
import os
import sqlite3
import json
import uuid
import secrets
import re
from datetime import datetime, timezone
from contextlib import contextmanager

from .grading import DEFAULT_RULES, grade_for, normalize_rules

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
DB_PATH = os.path.join(DATA_DIR, "lis.db")
TESTS_DIR = os.path.join(DATA_DIR, "tests")
LIBRARY_DIR = os.path.join(DATA_DIR, "library")


def _now():
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(TESTS_DIR, exist_ok=True)
    os.makedirs(LIBRARY_DIR, exist_ok=True)


@contextmanager
def connect():
    ensure_dirs()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    ensure_dirs()
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tests (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                require_roster INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                test_id TEXT NOT NULL,
                student_num TEXT NOT NULL,
                callsign TEXT NOT NULL,
                score INTEGER,
                total INTEGER,
                percent INTEGER,
                grade TEXT,
                answers_json TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                finished_at TEXT,
                invite_id TEXT,
                FOREIGN KEY(test_id) REFERENCES tests(id)
            );
            CREATE TABLE IF NOT EXISTS roster (
                test_id TEXT NOT NULL,
                student_num TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(test_id, student_num),
                FOREIGN KEY(test_id) REFERENCES tests(id)
            );
            CREATE TABLE IF NOT EXISTS invites (
                id TEXT PRIMARY KEY,
                test_id TEXT NOT NULL,
                code TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                used_at TEXT,
                used_num TEXT,
                used_call TEXT,
                for_num TEXT,
                note TEXT,
                UNIQUE(test_id, code),
                FOREIGN KEY(test_id) REFERENCES tests(id)
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                test_id TEXT NOT NULL,
                invite_id TEXT,
                is_master INTEGER NOT NULL DEFAULT 0,
                for_num TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(test_id) REFERENCES tests(id)
            );
            CREATE INDEX IF NOT EXISTS idx_attempts_test ON attempts(test_id);
            CREATE INDEX IF NOT EXISTS idx_attempts_num ON attempts(test_id, student_num);
            CREATE INDEX IF NOT EXISTS idx_invites_test ON invites(test_id);
            CREATE INDEX IF NOT EXISTS idx_roster_test ON roster(test_id);
            CREATE TABLE IF NOT EXISTS cadets (
                id TEXT PRIMARY KEY,
                seq INTEGER NOT NULL,
                callsign TEXT NOT NULL DEFAULT '',
                student_num TEXT NOT NULL DEFAULT '',
                full_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cadets_seq ON cadets(seq);
            """
        )
        # миграции
        tcols = {r[1] for r in conn.execute("PRAGMA table_info(tests)").fetchall()}
        if "require_roster" not in tcols:
            conn.execute(
                "ALTER TABLE tests ADD COLUMN require_roster INTEGER NOT NULL DEFAULT 1"
            )
        if "require_invite" in tcols:
            # старые тесты с invite → тоже roster-режим
            conn.execute(
                "UPDATE tests SET require_roster=1 WHERE require_invite=1"
            )
        acols = {r[1] for r in conn.execute("PRAGMA table_info(attempts)").fetchall()}
        if "invite_id" not in acols:
            conn.execute("ALTER TABLE attempts ADD COLUMN invite_id TEXT")
        acols = {r[1] for r in conn.execute("PRAGMA table_info(attempts)").fetchall()}
        if "timed_out" not in acols:
            conn.execute(
                "ALTER TABLE attempts ADD COLUMN timed_out INTEGER NOT NULL DEFAULT 0"
            )
        if "duration_sec" not in acols:
            conn.execute("ALTER TABLE attempts ADD COLUMN duration_sec INTEGER")
        if "continue_minutes" not in acols:
            conn.execute("ALTER TABLE attempts ADD COLUMN continue_minutes INTEGER")
        if "grade_manual" not in acols:
            conn.execute(
                "ALTER TABLE attempts ADD COLUMN grade_manual INTEGER NOT NULL DEFAULT 0"
            )
        acols = {r[1] for r in conn.execute("PRAGMA table_info(attempts)").fetchall()}
        if "submit_id" not in acols:
            conn.execute("ALTER TABLE attempts ADD COLUMN submit_id TEXT")
        acols = {r[1] for r in conn.execute("PRAGMA table_info(attempts)").fetchall()}
        if "start_id" not in acols:
            conn.execute("ALTER TABLE attempts ADD COLUMN start_id TEXT")
        icols = {r[1] for r in conn.execute("PRAGMA table_info(invites)").fetchall()}
        if "for_num" not in icols:
            conn.execute("ALTER TABLE invites ADD COLUMN for_num TEXT")
        scols = {r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()}
        if "for_num" not in scols:
            conn.execute("ALTER TABLE sessions ADD COLUMN for_num TEXT")
        rcols = {r[1] for r in conn.execute("PRAGMA table_info(roster)").fetchall()}
        if "callsign" not in rcols:
            conn.execute("ALTER TABLE roster ADD COLUMN callsign TEXT")
        if "full_name" not in rcols:
            conn.execute("ALTER TABLE roster ADD COLUMN full_name TEXT")
        if "group_num" not in rcols:
            conn.execute("ALTER TABLE roster ADD COLUMN group_num TEXT NOT NULL DEFAULT ''")
        if "stream_num" not in rcols:
            conn.execute(
                "ALTER TABLE roster ADD COLUMN stream_num TEXT NOT NULL DEFAULT ''"
            )
        if "timer_minutes" not in tcols:
            conn.execute("ALTER TABLE tests ADD COLUMN timer_minutes INTEGER")
        conn.execute(
            "UPDATE tests SET timer_minutes=40 WHERE timer_minutes IS NULL"
        )
        tcols = {r[1] for r in conn.execute("PRAGMA table_info(tests)").fetchall()}
        if "master_password" not in tcols:
            conn.execute(
                "ALTER TABLE tests ADD COLUMN master_password TEXT NOT NULL DEFAULT ''"
            )
        tcols = {r[1] for r in conn.execute("PRAGMA table_info(tests)").fetchall()}
        if "published_for_all" not in tcols:
            conn.execute(
                "ALTER TABLE tests ADD COLUMN published_for_all INTEGER NOT NULL DEFAULT 0"
            )
        tcols = {r[1] for r in conn.execute("PRAGMA table_info(tests)").fetchall()}
        if "questions_count" not in tcols:
            conn.execute("ALTER TABLE tests ADD COLUMN questions_count INTEGER")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workload_cells (
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                staff_id TEXT NOT NULL,
                day INTEGER NOT NULL,
                code TEXT NOT NULL DEFAULT '',
                hours TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (year, month, staff_id, day)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS workload_polygon (
                staff_id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                date_from TEXT NOT NULL DEFAULT '',
                date_to TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            )
            """
        )
        cadcols = {r[1] for r in conn.execute("PRAGMA table_info(cadets)").fetchall()}
        if "group_num" not in cadcols:
            conn.execute("ALTER TABLE cadets ADD COLUMN group_num TEXT NOT NULL DEFAULT ''")
        if "stream_num" not in cadcols:
            conn.execute(
                "ALTER TABLE cadets ADD COLUMN stream_num TEXT NOT NULL DEFAULT ''"
            )
        for col, typ in (
            ("group_id", "TEXT"),
            ("phone", "TEXT NOT NULL DEFAULT ''"),
            ("passport", "TEXT NOT NULL DEFAULT ''"),
            ("note", "TEXT NOT NULL DEFAULT ''"),
            ("content_hash", "TEXT NOT NULL DEFAULT ''"),
        ):
            if col not in cadcols:
                conn.execute(f"ALTER TABLE cadets ADD COLUMN {col} {typ}")
                cadcols.add(col)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS training_streams (
                id TEXT PRIMARY KEY,
                stream_num TEXT NOT NULL UNIQUE,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS training_stream_staff (
                stream_id TEXT NOT NULL,
                staff_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'stream_senior',
                PRIMARY KEY (stream_id, staff_id),
                FOREIGN KEY(stream_id) REFERENCES training_streams(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS training_groups (
                id TEXT PRIMARY KEY,
                stream_id TEXT NOT NULL,
                group_num TEXT NOT NULL,
                planned_count INTEGER NOT NULL DEFAULT 0,
                classroom TEXT NOT NULL DEFAULT '',
                polygon_name TEXT NOT NULL DEFAULT '',
                tent_num TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(stream_id, group_num),
                FOREIGN KEY(stream_id) REFERENCES training_streams(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS training_group_staff (
                group_id TEXT NOT NULL,
                staff_id TEXT NOT NULL,
                role TEXT NOT NULL,
                PRIMARY KEY (group_id, staff_id),
                FOREIGN KEY(group_id) REFERENCES training_groups(id)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_training_groups_stream ON training_groups(stream_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cadets_group ON cadets(group_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_cadets_hash ON cadets(content_hash)"
        )
        _migrate_legacy_cadets_to_groups(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS flight_sheets (
                user_id TEXT PRIMARY KEY,
                source_name TEXT NOT NULL DEFAULT '',
                columns_json TEXT NOT NULL,
                rows_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS library_docs (
                id TEXT PRIMARY KEY,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        _ensure_grading(conn)
        _recompute_auto_grades(conn)
        from . import auth as _auth

        _auth.init_auth_tables(conn)


def _ensure_grading(conn):
    row = conn.execute(
        "SELECT value FROM app_settings WHERE key='grading'"
    ).fetchone()
    if row:
        return
    conn.execute(
        "INSERT INTO app_settings(key, value) VALUES('grading', ?)",
        (json.dumps(DEFAULT_RULES, ensure_ascii=False),),
    )


def get_grading():
    with connect() as conn:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key='grading'"
        ).fetchone()
        if not row:
            return [dict(r) for r in DEFAULT_RULES]
        try:
            return normalize_rules(json.loads(row["value"]))
        except (ValueError, json.JSONDecodeError):
            return [dict(r) for r in DEFAULT_RULES]


def set_grading(rules):
    clean = normalize_rules(rules)
    payload = json.dumps(clean, ensure_ascii=False)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO app_settings(key, value) VALUES('grading', ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """,
            (payload,),
        )
        _recompute_auto_grades(conn, clean)
    return clean


def _recompute_auto_grades(conn, rules=None):
    """Пересчитать оценки попыток, которые преподаватель не правил вручную."""
    if rules is None:
        row = conn.execute(
            "SELECT value FROM app_settings WHERE key='grading'"
        ).fetchone()
        if not row:
            return
        try:
            rules = normalize_rules(json.loads(row["value"]))
        except (ValueError, json.JSONDecodeError):
            return
    rows = conn.execute(
        "SELECT id, percent, answers_json, grade_manual FROM attempts"
    ).fetchall()
    for row in rows:
        if row["grade_manual"]:
            continue
        percent = row["percent"] if row["percent"] is not None else 0
        score = total = None
        raw = row["answers_json"]
        if raw:
            try:
                score, total, percent = _score_from_answers(json.loads(raw))
            except Exception:
                score = total = None
        grade = grade_for(percent, rules)
        if score is None:
            conn.execute(
                "UPDATE attempts SET grade=? WHERE id=?",
                (grade, row["id"]),
            )
        else:
            conn.execute(
                "UPDATE attempts SET score=?, total=?, percent=?, grade=? WHERE id=?",
                (score, total, percent, grade, row["id"]),
            )


def _norm_num(num: str) -> str:
    return re.sub(r"\s+", "", (num or "").strip())


def _norm_call(call: str) -> str:
    return re.sub(r"\s+", " ", (call or "").strip())


def _norm_fio(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip())


def _gen_code():
    """Четырёхзначный пароль пересдачи (0000–9999)."""
    return f"{secrets.randbelow(10000):04d}"


def questions_count_from_html(html: str):
    """Число вопросов в одном прохождении из HTML теста."""
    if not html:
        return None
    m = re.search(r"QUESTIONS_PER_TEST\s*=\s*(\d+)", html)
    if m:
        n = int(m.group(1))
        return n if n > 0 else None
    return None


def questions_count_from_file(test_id: str):
    path = os.path.join(TESTS_DIR, f"{test_id}.html")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return questions_count_from_html(f.read())
    except OSError:
        return None


def set_questions_count(test_id: str, count):
    n = None
    if count is not None and str(count).strip() != "":
        n = int(count)
        if n < 1:
            n = None
    with connect() as conn:
        conn.execute(
            "UPDATE tests SET questions_count=? WHERE id=?",
            (n, test_id),
        )
    return n


def refresh_questions_count(test_id: str, html: str = None):
    """Обновить questions_count из HTML (строка или файл на диске)."""
    n = questions_count_from_html(html) if html is not None else questions_count_from_file(test_id)
    if n is not None:
        set_questions_count(test_id, n)
    return n


def backfill_questions_counts():
    """Для старых тестов без questions_count — прочитать из HTML."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT id FROM tests WHERE questions_count IS NULL OR questions_count < 1"
        ).fetchall()
    for r in rows:
        refresh_questions_count(r["id"])


def create_test(
    title: str,
    require_roster: bool = True,
    timer_minutes: int = 40,
    owner_user_id: str = None,
    department_id: str = None,
    master_password: str = "",
    published_for_all: bool = False,
    questions_count=None,
) -> str:
    tid = uuid.uuid4().hex[:12]
    master = (master_password or "").strip()
    qn = None
    if questions_count is not None and str(questions_count).strip() != "":
        qn = int(questions_count)
        if qn < 1:
            qn = None
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tests(
              id, title, created_at, require_roster, timer_minutes,
              owner_user_id, department_id, master_password, published_for_all,
              questions_count
            )
            VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (
                tid,
                title,
                _now(),
                1 if require_roster else 0,
                int(timer_minutes) if timer_minutes else None,
                owner_user_id,
                department_id,
                master,
                1 if published_for_all else 0,
                qn,
            ),
        )
    return tid


def list_tests(*, include_master_password: bool = False):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT t.id, t.title, t.created_at, t.require_roster, t.timer_minutes,
              t.owner_user_id, t.department_id, t.master_password,
              COALESCE(t.published_for_all, 0) AS published_for_all,
              t.questions_count,
              u.display_name AS owner_name, u.login AS owner_login, u.role AS owner_role,
              d.name AS department_name,
              (SELECT COUNT(*) FROM roster r WHERE r.test_id=t.id) AS roster_count,
              (SELECT COUNT(*) FROM attempts a
                 WHERE a.test_id=t.id AND a.status='finished') AS finished_count
            FROM tests t
            LEFT JOIN users u ON u.id=t.owner_user_id
            LEFT JOIN departments d ON d.id=t.department_id
            ORDER BY t.created_at DESC
            """
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        pwd = (d.pop("master_password", None) or "").strip()
        d["has_master_password"] = bool(pwd)
        d["published_for_all"] = bool(d.get("published_for_all"))
        if include_master_password:
            d["master_password"] = pwd
        out.append(d)
    return out


def list_published_catalog():
    """Тесты старших инструкторов с флагом «Опубликовать для всех»."""
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT t.id, t.title, t.created_at, t.timer_minutes,
              t.owner_user_id, t.department_id,
              COALESCE(t.published_for_all, 0) AS published_for_all,
              t.questions_count,
              u.display_name AS owner_name, u.login AS owner_login, u.role AS owner_role,
              d.name AS department_name
            FROM tests t
            LEFT JOIN users u ON u.id=t.owner_user_id
            LEFT JOIN departments d ON d.id=t.department_id
            WHERE COALESCE(t.published_for_all, 0)=1
              AND u.role='senior'
            ORDER BY t.created_at DESC
            """
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["published_for_all"] = True
        out.append(d)
    return out


def get_test(test_id: str, *, include_master_password: bool = False):
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, title, created_at, require_roster, timer_minutes,
                   owner_user_id, department_id, master_password,
                   COALESCE(published_for_all, 0) AS published_for_all,
                   questions_count
            FROM tests WHERE id=?
            """,
            (test_id,),
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    pwd = (d.pop("master_password", None) or "").strip()
    d["has_master_password"] = bool(pwd)
    d["published_for_all"] = bool(d.get("published_for_all"))
    if include_master_password:
        d["master_password"] = pwd
    else:
        d["_master_password"] = pwd  # для внутренней проверки redeem
    return d


def update_test(
    test_id: str,
    *,
    title: str = None,
    timer_minutes=None,
    master_password: str = None,
    published_for_all=None,
    questions_count=None,
):
    t = get_test(test_id, include_master_password=True)
    if not t:
        raise ValueError("Тест не найден")
    new_title = (title if title is not None else t.get("title") or "").strip()
    if not new_title:
        raise ValueError("Укажите название теста")
    if timer_minutes is None:
        mins = t.get("timer_minutes")
    elif timer_minutes == "" or timer_minutes is False:
        mins = None
    else:
        mins = int(timer_minutes)
        if mins < 1 or mins > 600:
            raise ValueError("Таймер: от 1 до 600 минут")
    if master_password is None:
        master = t.get("master_password") or ""
    else:
        master = (master_password or "").strip()
    if published_for_all is None:
        pub = 1 if t.get("published_for_all") else 0
    else:
        pub = 1 if published_for_all else 0
    if questions_count is None:
        qn = t.get("questions_count")
    elif questions_count == "" or questions_count is False:
        qn = None
    else:
        qn = int(questions_count)
        if qn < 1:
            qn = None
    with connect() as conn:
        conn.execute(
            """
            UPDATE tests
            SET title=?, timer_minutes=?, master_password=?, published_for_all=?,
                questions_count=?
            WHERE id=?
            """,
            (new_title, mins, master, pub, qn, test_id),
        )
    return get_test(test_id, include_master_password=True)


def set_timer_minutes(test_id: str, minutes):
    if minutes is None or minutes == "":
        val = None
    else:
        val = int(minutes)
        if val < 1 or val > 600:
            raise ValueError("Таймер: от 1 до 600 минут")
    with connect() as conn:
        conn.execute(
            "UPDATE tests SET timer_minutes=? WHERE id=?",
            (val, test_id),
        )
    return val


def set_require_roster(test_id: str, required: bool):
    with connect() as conn:
        conn.execute(
            "UPDATE tests SET require_roster=? WHERE id=?",
            (1 if required else 0, test_id),
        )


def delete_test(test_id: str):
    path = os.path.join(TESTS_DIR, f"{test_id}.html")
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE test_id=?", (test_id,))
        conn.execute("DELETE FROM invites WHERE test_id=?", (test_id,))
        conn.execute("DELETE FROM roster WHERE test_id=?", (test_id,))
        conn.execute("DELETE FROM attempts WHERE test_id=?", (test_id,))
        conn.execute("DELETE FROM tests WHERE id=?", (test_id,))
    if os.path.isfile(path):
        os.remove(path)


def parse_roster_text(text: str):
    """Строки вида «101 Сокол» или «101;Сокол» / «101,Сокол»."""
    entries = []
    seen = set()
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if ";" in line or "\t" in line:
            parts = re.split(r"[;\t]", line, maxsplit=1)
        elif "," in line and not re.match(r"^\d+\s*,\s*\d+", line):
            parts = line.split(",", 1)
        else:
            parts = line.split(None, 1)
        n = _norm_num(parts[0] if parts else "")
        call = _norm_call(parts[1] if len(parts) > 1 else "")
        if not n or n in seen:
            continue
        seen.add(n)
        entries.append({"num": n, "call": call})
    return entries


def _normalize_entries(entries):
    out = []
    seen = set()
    for item in entries or []:
        if isinstance(item, str):
            n, call, fio, group, stream = _norm_num(item), "", "", "", ""
        elif isinstance(item, dict):
            n = _norm_num(item.get("num") or item.get("student_num") or "")
            call = _norm_call(item.get("call") or item.get("callsign") or "")
            fio = _norm_fio(item.get("fio") or item.get("full_name") or "")
            group = _norm_call(item.get("group") or item.get("group_num") or "")
            stream = _norm_call(item.get("stream") or item.get("stream_num") or "")
        else:
            continue
        if not n or n in seen:
            continue
        seen.add(n)
        out.append(
            {"num": n, "call": call, "fio": fio, "group": group, "stream": stream}
        )
    return out


def set_roster(test_id: str, entries):
    items = _normalize_entries(entries)
    with connect() as conn:
        conn.execute("DELETE FROM roster WHERE test_id=?", (test_id,))
        now = _now()
        for it in items:
            conn.execute(
                """
                INSERT INTO roster(
                  test_id, student_num, callsign, full_name, group_num, stream_num, created_at
                )
                VALUES(?,?,?,?,?,?,?)
                """,
                (
                    test_id,
                    it["num"],
                    it["call"] or None,
                    it["fio"] or None,
                    it.get("group") or "",
                    it.get("stream") or "",
                    now,
                ),
            )
        conn.execute("UPDATE tests SET require_roster=1 WHERE id=?", (test_id,))
    return items


def upsert_roster_entry(
    test_id: str,
    student_num: str,
    callsign: str = "",
    full_name: str = "",
    group_num: str = "",
    stream_num: str = "",
):
    n = _norm_num(student_num)
    call = _norm_call(callsign)
    fio = _norm_fio(full_name)
    group = _norm_call(group_num)
    stream = _norm_call(stream_num)
    if not n:
        raise ValueError("Укажите номер курсанта")
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO roster(
              test_id, student_num, callsign, full_name, group_num, stream_num, created_at
            )
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(test_id, student_num) DO UPDATE SET
              callsign=excluded.callsign,
              full_name=excluded.full_name,
              group_num=excluded.group_num,
              stream_num=excluded.stream_num
            """,
            (test_id, n, call or None, fio or None, group, stream, _now()),
        )
        conn.execute("UPDATE tests SET require_roster=1 WHERE id=?", (test_id,))
    return {
        "num": n,
        "call": call,
        "fio": fio,
        "group": group,
        "stream": stream,
    }


def remove_roster_entry(test_id: str, student_num: str) -> bool:
    n = _norm_num(student_num)
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM roster WHERE test_id=? AND student_num=?",
            (test_id, n),
        )
        return cur.rowcount > 0


def remove_roster_entries(test_id: str, student_nums) -> int:
    nums = [_norm_num(n) for n in (student_nums or []) if str(n).strip()]
    if not nums:
        return 0
    deleted = 0
    with connect() as conn:
        for n in nums:
            cur = conn.execute(
                "DELETE FROM roster WHERE test_id=? AND student_num=?",
                (test_id, n),
            )
            deleted += cur.rowcount or 0
    return deleted


def list_roster(test_id: str):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT r.student_num,
              COALESCE(NULLIF(TRIM(r.callsign), ''),
                (SELECT a.callsign FROM attempts a
                   WHERE a.test_id=r.test_id AND a.student_num=r.student_num
                   ORDER BY a.created_at DESC LIMIT 1)
              ) AS callsign,
              r.callsign AS roster_callsign,
              COALESCE(r.full_name, '') AS full_name,
              COALESCE(
                NULLIF(TRIM(r.group_num), ''),
                (SELECT c.group_num FROM cadets c WHERE c.student_num=r.student_num LIMIT 1),
                ''
              ) AS group_num,
              COALESCE(
                NULLIF(TRIM(r.stream_num), ''),
                (SELECT c.stream_num FROM cadets c WHERE c.student_num=r.student_num LIMIT 1),
                ''
              ) AS stream_num,
              (SELECT a.status FROM attempts a
                 WHERE a.test_id=r.test_id AND a.student_num=r.student_num
                 ORDER BY CASE a.status WHEN 'finished' THEN 0 WHEN 'unlocked' THEN 1 ELSE 2 END
                 LIMIT 1) AS status,
              (SELECT a.grade FROM attempts a
                 WHERE a.test_id=r.test_id AND a.student_num=r.student_num AND a.status='finished'
                 ORDER BY a.finished_at DESC LIMIT 1) AS grade,
              (SELECT a.score FROM attempts a
                 WHERE a.test_id=r.test_id AND a.student_num=r.student_num AND a.status='finished'
                 ORDER BY a.finished_at DESC LIMIT 1) AS score,
              (SELECT a.total FROM attempts a
                 WHERE a.test_id=r.test_id AND a.student_num=r.student_num AND a.status='finished'
                 ORDER BY a.finished_at DESC LIMIT 1) AS total,
              (SELECT COUNT(*) FROM invites i
                 WHERE i.test_id=r.test_id AND i.for_num=r.student_num AND i.status='used'
              ) AS retake_count,
              (SELECT i.code FROM invites i
                 WHERE i.test_id=r.test_id AND i.for_num=r.student_num AND i.status='unused'
                 ORDER BY i.created_at DESC LIMIT 1
              ) AS retake_code
            FROM roster r
            WHERE r.test_id=?
            ORDER BY CAST(r.student_num AS INTEGER), r.student_num
            """,
            (test_id,),
        ).fetchall()
    out = []
    for i, r in enumerate(rows, start=1):
        d = dict(r)
        d["npp"] = i
        out.append(d)
    return out


def get_roster_entry(test_id: str, student_num: str):
    n = _norm_num(student_num)
    with connect() as conn:
        row = conn.execute(
            """
            SELECT student_num, callsign, full_name, group_num, stream_num
            FROM roster WHERE test_id=? AND student_num=?
            """,
            (test_id, n),
        ).fetchone()
    return dict(row) if row else None


def in_roster(test_id: str, student_num: str) -> bool:
    return get_roster_entry(test_id, student_num) is not None


def roster_callsign_ok(test_id: str, student_num: str, callsign: str) -> bool:
    """Если в списке задан позывной — он должен совпасть (без учёта регистра)."""
    entry = get_roster_entry(test_id, student_num)
    if not entry:
        return False
    expected = _norm_call(entry.get("callsign") or "")
    if not expected:
        return True
    return expected.casefold() == _norm_call(callsign).casefold()


def roster_count(test_id: str) -> int:
    with connect() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM roster WHERE test_id=?", (test_id,)
        ).fetchone()[0]


def create_retake_code(test_id: str, student_num: str):
    n = _norm_num(student_num)
    with connect() as conn:
        # один активный пароль на номер — старые неиспользованные снимаем
        conn.execute(
            """
            UPDATE invites SET status='revoked'
            WHERE test_id=? AND for_num=? AND status='unused'
            """,
            (test_id, n),
        )
    for _ in range(40):
        code = _gen_code()
        iid = uuid.uuid4().hex
        try:
            with connect() as conn:
                conn.execute(
                    """
                    INSERT INTO invites(id, test_id, code, status, created_at, for_num, note)
                    VALUES(?,?,?,'unused',?,?,?)
                    """,
                    (iid, test_id, code, _now(), n, f"пересдача для №{n}"),
                )
            return {"id": iid, "code": code, "for_num": n, "status": "unused"}
        except sqlite3.IntegrityError:
            continue
    return None


def list_retake_codes(test_id: str):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM invites
            WHERE test_id=? AND for_num IS NOT NULL AND status IN ('unused', 'used')
            ORDER BY CASE status WHEN 'unused' THEN 0 ELSE 1 END, created_at DESC
            """,
            (test_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_invite_by_code(test_id: str, code: str):
    # цифровой пароль: только trim/пробелы; буквенные старые коды — upper
    raw = (code or "").strip().replace(" ", "")
    code = raw if raw.isdigit() else raw.upper()
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM invites WHERE test_id=? AND code=?",
            (test_id, code),
        ).fetchone()
    return dict(row) if row else None


def create_session(test_id: str, invite_id=None, is_master: bool = False, for_num=None):
    token = secrets.token_urlsafe(24)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO sessions(token, test_id, invite_id, is_master, for_num, created_at)
            VALUES(?,?,?,?,?,?)
            """,
            (
                token,
                test_id,
                invite_id,
                1 if is_master else 0,
                _norm_num(for_num) if for_num else None,
                _now(),
            ),
        )
    return token


def get_session(token: str):
    if not token:
        return None
    with connect() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE token=?", (token,)).fetchone()
    return dict(row) if row else None


def consume_invite(invite_id: str, student_num: str, callsign: str):
    with connect() as conn:
        cur = conn.execute(
            """
            UPDATE invites SET status='used', used_at=?, used_num=?, used_call=?
            WHERE id=? AND status='unused'
            """,
            (_now(), _norm_num(student_num), callsign.strip(), invite_id),
        )
        return cur.rowcount > 0


def access_status(test_id: str):
    t = get_test(test_id)
    if not t:
        return None
    with connect() as conn:
        rc = conn.execute(
            "SELECT COUNT(*) FROM roster WHERE test_id=?", (test_id,)
        ).fetchone()[0]
        fin = conn.execute(
            "SELECT COUNT(*) FROM attempts WHERE test_id=? AND status='finished'",
            (test_id,),
        ).fetchone()[0]
        retake_free = conn.execute(
            """
            SELECT COUNT(*) FROM invites
            WHERE test_id=? AND status='unused' AND for_num IS NOT NULL
            """,
            (test_id,),
        ).fetchone()[0]
    return {
        "require_roster": bool(t.get("require_roster")),
        "timer_minutes": t.get("timer_minutes"),
        "questions_count": t.get("questions_count"),
        "roster_count": rc,
        "finished_count": fin,
        "retake_unused": retake_free,
        # совместимость со старым мостом
        "require_invite": False,
    }


def get_attempt(test_id: str, student_num: str, callsign: str = None):
    """Попытка по номеру (номер уникален для доступа)."""
    n = _norm_num(student_num)
    with connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM attempts
            WHERE test_id=? AND student_num=?
            ORDER BY CASE status WHEN 'finished' THEN 0 WHEN 'unlocked' THEN 1 ELSE 2 END,
                     created_at DESC
            LIMIT 1
            """,
            (test_id, n),
        ).fetchone()
    return dict(row) if row else None


def can_start(test_id: str, student_num: str, callsign: str = None):
    """Без пароля пересдачи нельзя стартовать повторно (finished и unlocked).
    status=continue — разрешена досдача оставшихся вопросов."""
    att = get_attempt(test_id, student_num)
    if not att:
        return True, None
    if att["status"] == "continue":
        return True, att
    if att["status"] in ("finished", "unlocked", "started"):
        return False, att
    return True, att


def begin_attempt(test_id: str, student_num: str, callsign: str, start_id: str, invite_id=None):
    """Фиксирует номер в момент старта. Повторный вход с другим start_id закрыт."""
    start_id = (start_id or "").strip()
    if not start_id:
        raise PermissionError("Не удалось начать тест")
    student_num = _norm_num(student_num)
    callsign = (callsign or "").strip()
    att = get_attempt(test_id, student_num)
    now = _now()
    if att and att.get("status") == "continue":
        return att["id"]
    if att and att.get("status") == "started":
        if (att.get("start_id") or "") == start_id:
            return att["id"]
        raise PermissionError(
            "Этот номер уже использован. Для пересдачи нужен пароль от преподавателя."
        )
    if att and att.get("status") in ("finished", "unlocked"):
        if not invite_id:
            raise PermissionError(
                "Этот номер уже использован. Для пересдачи нужен пароль от преподавателя."
            )
        with connect() as conn:
            conn.execute(
                """
                UPDATE attempts
                SET status='started', start_id=?, callsign=?, submit_id=NULL
                WHERE id=?
                """,
                (start_id, callsign, att["id"]),
            )
        return att["id"]
    if att:
        raise PermissionError(
            "Этот номер уже использован. Для пересдачи нужен пароль от преподавателя."
        )
    aid = uuid.uuid4().hex
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO attempts(
                id, test_id, student_num, callsign, score, total, percent,
                grade, answers_json, status, created_at, finished_at, invite_id,
                timed_out, duration_sec, continue_minutes, grade_manual, submit_id, start_id
            ) VALUES(?,?,?,?,0,0,0,'','[]','started',?,NULL,?,0,NULL,NULL,0,NULL,?)
            """,
            (aid, test_id, student_num, callsign, now, invite_id, start_id),
        )
    return aid


def _merge_answers(old_answers, new_answers):
    old = list(old_answers or [])
    new_list = list(new_answers or [])
    by_i = {}
    for a in new_list:
        try:
            key = int(a.get("i"))
        except Exception:
            continue
        by_i[key] = a
    merged = []
    seen = set()
    for a in old:
        try:
            key = int(a.get("i"))
        except Exception:
            merged.append(a)
            continue
        seen.add(key)
        if a.get("pick") is None and key in by_i:
            merged.append(by_i[key])
        else:
            merged.append(a)
    for a in new_list:
        try:
            key = int(a.get("i"))
        except Exception:
            continue
        if key not in seen:
            merged.append(a)
    return merged


def _score_from_answers(answers):
    items = list(answers or [])
    total = len(items)
    score = 0
    for a in items:
        pick = a.get("pick")
        correct = a.get("correct")
        ok = a.get("ok")
        if ok is True or (pick is not None and correct is not None and int(pick) == int(correct)):
            score += 1
    percent = int(round(score / total * 100)) if total else 0
    return score, total, percent


def upsert_finished_attempt(
    test_id: str,
    student_num: str,
    callsign: str,
    score: int,
    total: int,
    percent: int,
    grade: str,
    answers,
    invite_id=None,
    timed_out: bool = False,
    duration_sec=None,
    is_continue: bool = False,
    submit_id: str = None,
):
    student_num = _norm_num(student_num)
    callsign = callsign.strip()
    att = get_attempt(test_id, student_num)
    now = _now()
    answers_list = list(answers or [])
    has_unanswered = any(a.get("pick") is None for a in answers_list)
    # истечение таймера: явный флаг с клиента ИЛИ есть вопросы без ответа
    timed = 1 if timed_out or has_unanswered else 0
    dur = int(duration_sec) if duration_sec is not None else None
    if dur is not None and dur < 0:
        dur = None

    if is_continue and att:
        prev = []
        raw = att.get("answers_json")
        if raw:
            try:
                prev = json.loads(raw)
            except Exception:
                prev = []
        answers_list = _merge_answers(prev, answers_list)
        timed = 0 if all(a.get("pick") is not None for a in answers_list) else (
            1 if att.get("timed_out") else timed
        )
        if dur is not None and att.get("duration_sec"):
            try:
                dur = int(att["duration_sec"]) + int(dur)
            except Exception:
                pass

    if answers_list:
        score, total, percent = _score_from_answers(answers_list)
    if is_continue and att and att.get("grade_manual"):
        grade = att.get("grade") or grade
    else:
        grade = grade_for(percent, get_grading())
    answers_json = json.dumps(answers_list, ensure_ascii=False)
    with connect() as conn:
        if att and att["status"] == "finished" and not is_continue:
            raise PermissionError(
                "Этот номер уже сдал тест. Нужен пароль пересдачи от преподавателя."
            )
        if att:
            # при обычной пересдаче (unlocked) не суммируем duration со старым
            if att["status"] == "unlocked" and not is_continue:
                timed = 1 if timed_out else 0
            keep_manual = bool(att.get("grade_manual")) and is_continue
            conn.execute(
                """
                UPDATE attempts SET callsign=?, score=?, total=?, percent=?,
                    grade=CASE WHEN ? THEN grade ELSE ? END,
                    grade_manual=CASE WHEN ? THEN grade_manual ELSE 0 END,
                    answers_json=?, status='finished', finished_at=?,
                    invite_id=COALESCE(?, invite_id),
                    timed_out=?, duration_sec=?, continue_minutes=NULL,
                    submit_id=COALESCE(?, submit_id)
                WHERE id=?
                """,
                (
                    callsign,
                    score,
                    total,
                    percent,
                    1 if keep_manual else 0,
                    grade,
                    1 if keep_manual else 0,
                    answers_json,
                    now,
                    invite_id,
                    timed,
                    dur,
                    (submit_id or "").strip() or None,
                    att["id"],
                ),
            )
            aid = att["id"]
        else:
            aid = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO attempts(
                    id, test_id, student_num, callsign, score, total, percent,
                    grade, answers_json, status, created_at, finished_at, invite_id,
                    timed_out, duration_sec, continue_minutes, grade_manual, submit_id
                ) VALUES(?,?,?,?,?,?,?,?,?,'finished',?,?,?,?,?,NULL,0,?)
                """,
                (
                    aid,
                    test_id,
                    student_num,
                    callsign,
                    score,
                    total,
                    percent,
                    grade,
                    answers_json,
                    now,
                    now,
                    invite_id,
                    timed,
                    dur,
                    (submit_id or "").strip() or None,
                ),
            )
    return aid


def allow_continue_attempt(attempt_id: str, minutes: int):
    minutes = int(minutes)
    if minutes < 1 or minutes > 600:
        raise ValueError("Таймер: от 1 до 600 минут")
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM attempts WHERE id=?", (attempt_id,)
        ).fetchone()
        if not row:
            raise ValueError("Попытка не найдена")
        answers = []
        raw = row["answers_json"] if "answers_json" in row.keys() else None
        if raw:
            try:
                answers = json.loads(raw)
            except Exception:
                answers = []
        unanswered = [a for a in answers if a.get("pick") is None]
        if not unanswered:
            raise ValueError("Нет вопросов без ответа — досдача не нужна")
        conn.execute(
            """
            UPDATE attempts
            SET status='continue', continue_minutes=?, invite_id=NULL
            WHERE id=?
            """,
            (minutes, attempt_id),
        )
    return get_attempt_by_id(attempt_id)


def set_attempt_grade(attempt_id: str, grade: str):
    grade = (grade or "").strip()
    if not grade:
        raise ValueError("Укажите оценку")
    with connect() as conn:
        cur = conn.execute(
            "UPDATE attempts SET grade=?, grade_manual=1 WHERE id=?",
            (grade, attempt_id),
        )
        if cur.rowcount == 0:
            raise ValueError("Попытка не найдена")
    return get_attempt_by_id(attempt_id)


def unlock_attempt(test_id: str, student_num: str, callsign: str = None, issue_retake: bool = True):
    """Помечает попытку как unlocked (UI) и опционально выдаёт пароль.
    Старые баллы сохраняются до новой сдачи; старт без пароля всё равно закрыт.
    """
    n = _norm_num(student_num)
    with connect() as conn:
        cur = conn.execute(
            """
            UPDATE attempts SET status='unlocked', invite_id=NULL
            WHERE test_id=? AND student_num=? AND status='finished'
            """,
            (test_id, n),
        )
        if cur.rowcount <= 0:
            return None
    extra = create_retake_code(test_id, n) if issue_retake else None
    return {"unlocked": True, "invite": extra, "retake": extra}


def list_attempts(test_id=None):
    group_expr = """
      COALESCE(
        NULLIF(TRIM((
          SELECT r.group_num FROM roster r
          WHERE r.test_id=a.test_id AND r.student_num=a.student_num LIMIT 1
        )), ''),
        NULLIF(TRIM((
          SELECT c.group_num FROM cadets c
          WHERE c.student_num=a.student_num LIMIT 1
        )), ''),
        ''
      ) AS group_num
    """
    stream_expr = """
      COALESCE(
        NULLIF(TRIM((
          SELECT r.stream_num FROM roster r
          WHERE r.test_id=a.test_id AND r.student_num=a.student_num LIMIT 1
        )), ''),
        NULLIF(TRIM((
          SELECT c.stream_num FROM cadets c
          WHERE c.student_num=a.student_num LIMIT 1
        )), ''),
        ''
      ) AS stream_num
    """
    with connect() as conn:
        if test_id:
            rows = conn.execute(
                f"""
                SELECT a.*, t.title AS test_title,
                  {group_expr},
                  {stream_expr}
                FROM attempts a JOIN tests t ON t.id=a.test_id
                WHERE a.test_id=?
                ORDER BY CASE WHEN a.finished_at IS NULL THEN 1 ELSE 0 END,
                         a.finished_at DESC, a.created_at DESC
                """,
                (test_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""
                SELECT a.*, t.title AS test_title,
                  {group_expr},
                  {stream_expr}
                FROM attempts a JOIN tests t ON t.id=a.test_id
                ORDER BY CASE WHEN a.finished_at IS NULL THEN 1 ELSE 0 END,
                         a.finished_at DESC, a.created_at DESC
                """
            ).fetchall()
    return [_attempt_out(r) for r in rows]


def get_attempt_by_id(attempt_id: str):
    with connect() as conn:
        row = conn.execute(
            """
            SELECT a.*, t.title AS test_title
            FROM attempts a JOIN tests t ON t.id=a.test_id
            WHERE a.id=?
            """,
            (attempt_id,),
        ).fetchone()
    return _attempt_out(row) if row else None


def _attempt_out(row):
    d = dict(row)
    raw = d.pop("answers_json", None)
    answers = []
    if raw:
        try:
            answers = json.loads(raw)
        except Exception:
            answers = []
    d["answers"] = answers
    d["timed_out"] = bool(d.get("timed_out"))
    d["grade_manual"] = bool(d.get("grade_manual"))
    answered = sum(1 for a in answers if a.get("pick") is not None)
    unanswered = sum(1 for a in answers if a.get("pick") is None)
    correct = sum(
        1
        for a in answers
        if a.get("ok") is True
        or (
            a.get("pick") is not None
            and a.get("correct") is not None
            and int(a.get("pick")) == int(a.get("correct"))
        )
    )
    wrong = answered - correct
    d["answered_count"] = answered
    d["unanswered_count"] = unanswered
    d["correct_count"] = correct
    d["wrong_count"] = max(0, wrong)
    return d


def _migrate_legacy_cadets_to_groups(conn):
    """Создаёт потоки/группы из stream_num+group_num и проставляет group_id."""
    rows = conn.execute(
        """
        SELECT id, stream_num, group_num FROM cadets
        WHERE (group_id IS NULL OR group_id='')
          AND trim(COALESCE(stream_num,''))<>''
          AND trim(COALESCE(group_num,''))<>''
        """
    ).fetchall()
    if not rows:
        return
    cache = {}
    for r in rows:
        stream = _norm_call(r["stream_num"] or "")
        group = _norm_call(r["group_num"] or "")
        if not stream or not group:
            continue
        key = (stream, group)
        if key not in cache:
            gid = ensure_training_group(conn, stream, group)
            cache[key] = gid
        conn.execute(
            "UPDATE cadets SET group_id=? WHERE id=?",
            (cache[key], r["id"]),
        )


def ensure_training_stream(conn, stream_num: str, note: str = "") -> str:
    stream = _norm_call(stream_num)
    if not stream:
        raise ValueError("Укажите номер потока")
    row = conn.execute(
        "SELECT id FROM training_streams WHERE stream_num=?", (stream,)
    ).fetchone()
    if row:
        note_s = (note or "").strip()
        if note_s:
            conn.execute(
                "UPDATE training_streams SET note=? WHERE id=? AND trim(COALESCE(note,''))=''",
                (note_s, row["id"]),
            )
        return row["id"]
    sid = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO training_streams(id, stream_num, note, created_at) VALUES(?,?,?,?)",
        (sid, stream, (note or "").strip(), _now()),
    )
    return sid


def ensure_training_group(
    conn,
    stream_num: str,
    group_num: str,
    *,
    planned_count: int = 0,
    classroom: str = "",
    polygon_name: str = "",
    tent_num: str = "",
    note: str = "",
) -> str:
    stream = _norm_call(stream_num)
    group = _norm_call(group_num)
    if not stream or not group:
        raise ValueError("Укажите поток и группу")
    sid = ensure_training_stream(conn, stream)
    row = conn.execute(
        "SELECT id FROM training_groups WHERE stream_id=? AND group_num=?",
        (sid, group),
    ).fetchone()
    if row:
        # дополняем пустые поля при повторном импорте оргструктуры
        cur = conn.execute(
            "SELECT * FROM training_groups WHERE id=?", (row["id"],)
        ).fetchone()
        updates = []
        vals = []
        if planned_count and not int(cur["planned_count"] or 0):
            updates.append("planned_count=?")
            vals.append(int(planned_count))
        for field, val in (
            ("classroom", classroom),
            ("polygon_name", polygon_name),
            ("tent_num", tent_num),
            ("note", note),
        ):
            if (val or "").strip() and not (cur[field] or "").strip():
                updates.append(f"{field}=?")
                vals.append((val or "").strip())
        if updates:
            vals.append(row["id"])
            conn.execute(
                "UPDATE training_groups SET " + ", ".join(updates) + " WHERE id=?",
                vals,
            )
        return row["id"]
    gid = uuid.uuid4().hex
    conn.execute(
        """
        INSERT INTO training_groups(
          id, stream_id, group_num, planned_count, classroom, polygon_name,
          tent_num, note, created_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (
            gid,
            sid,
            group,
            int(planned_count or 0),
            (classroom or "").strip(),
            (polygon_name or "").strip(),
            (tent_num or "").strip(),
            (note or "").strip(),
            _now(),
        ),
    )
    return gid


def cadet_content_hash(
    *,
    stream_num: str,
    group_num: str,
    student_num: str,
    callsign: str = "",
    full_name: str = "",
    phone: str = "",
    passport: str = "",
) -> str:
    import hashlib

    parts = [
        _norm_call(stream_num),
        _norm_call(group_num),
        _norm_num(student_num),
        _norm_call(callsign),
        _norm_fio(full_name),
        _norm_call(phone),
        _norm_call(passport),
    ]
    raw = "|".join(parts).casefold().encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def list_cadets():
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.seq, c.callsign, c.student_num, c.full_name, c.group_num,
                   c.stream_num, c.group_id, c.phone, c.passport, c.note, c.content_hash,
                   c.created_at, c.owner_user_id, c.department_id,
                   g.classroom, g.polygon_name, g.tent_num, g.planned_count,
                   g.note AS group_note
            FROM cadets c
            LEFT JOIN training_groups g ON g.id=c.group_id
            ORDER BY c.seq ASC, c.created_at ASC
            """
        ).fetchall()
    out = []
    for i, r in enumerate(rows, start=1):
        d = dict(r)
        d["npp"] = i
        out.append(d)
    return out


def cadet_num_exists(student_num: str, exclude_id: str = None) -> bool:
    num = _norm_num(student_num)
    if not num:
        return False
    with connect() as conn:
        if exclude_id:
            row = conn.execute(
                "SELECT id FROM cadets WHERE student_num=? AND id!=?",
                (num, exclude_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM cadets WHERE student_num=?", (num,)
            ).fetchone()
    return bool(row)


def add_cadet(
    callsign: str = "",
    student_num: str = "",
    full_name: str = "",
    group_num: str = "",
    stream_num: str = "",
    owner_user_id: str = None,
    department_id: str = None,
    phone: str = "",
    passport: str = "",
    note: str = "",
    group_id: str = None,
):
    call = _norm_call(callsign)
    num = _norm_num(student_num)
    fio = _norm_fio(full_name)
    group = _norm_call(group_num)
    stream = _norm_call(stream_num)
    phone_s = _norm_call(phone)
    passport_s = _norm_call(passport)
    note_s = (note or "").strip()
    if not num:
        raise ValueError("Укажите номер курсанта")
    ch = cadet_content_hash(
        stream_num=stream,
        group_num=group,
        student_num=num,
        callsign=call,
        full_name=fio,
        phone=phone_s,
        passport=passport_s,
    )
    cid = uuid.uuid4().hex
    with connect() as conn:
        row = conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM cadets").fetchone()
        seq = int(row["n"] if row else 1)
        exists = conn.execute(
            "SELECT id FROM cadets WHERE student_num=?",
            (num,),
        ).fetchone()
        if exists:
            raise ValueError("Курсант с таким номером уже существует")
        if ch:
            same = conn.execute(
                "SELECT id FROM cadets WHERE content_hash=? AND content_hash<>''",
                (ch,),
            ).fetchone()
            if same:
                raise ValueError("Такая запись уже есть (повтор содержимого)")
        gid = (group_id or "").strip() or None
        if not gid and stream and group:
            gid = ensure_training_group(conn, stream, group)
        conn.execute(
            """
            INSERT INTO cadets(
              id, seq, callsign, student_num, full_name, group_num, stream_num,
              group_id, phone, passport, note, content_hash,
              created_at, owner_user_id, department_id
            )
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                cid,
                seq,
                call,
                num,
                fio,
                group,
                stream,
                gid,
                phone_s,
                passport_s,
                note_s,
                ch,
                _now(),
                owner_user_id,
                department_id,
            ),
        )
    return get_cadet(cid)


def update_cadet(
    cadet_id: str,
    callsign: str = None,
    student_num: str = None,
    full_name: str = None,
    group_num: str = None,
    stream_num: str = None,
    phone: str = None,
    passport: str = None,
    note: str = None,
):
    cur = get_cadet(cadet_id)
    if not cur:
        return None
    call = _norm_call(callsign) if callsign is not None else cur["callsign"]
    num = _norm_num(student_num) if student_num is not None else cur["student_num"]
    fio = _norm_fio(full_name) if full_name is not None else cur.get("full_name") or ""
    group = (
        _norm_call(group_num) if group_num is not None else (cur.get("group_num") or "")
    )
    stream = (
        _norm_call(stream_num)
        if stream_num is not None
        else (cur.get("stream_num") or "")
    )
    phone_s = _norm_call(phone) if phone is not None else (cur.get("phone") or "")
    passport_s = (
        _norm_call(passport) if passport is not None else (cur.get("passport") or "")
    )
    note_s = (note if note is not None else (cur.get("note") or "")).strip()
    if not num:
        raise ValueError("Укажите номер курсанта")
    ch = cadet_content_hash(
        stream_num=stream,
        group_num=group,
        student_num=num,
        callsign=call,
        full_name=fio,
        phone=phone_s,
        passport=passport_s,
    )
    with connect() as conn:
        exists = conn.execute(
            "SELECT id FROM cadets WHERE student_num=? AND id!=?",
            (num, cadet_id),
        ).fetchone()
        if exists:
            raise ValueError("Курсант с таким номером уже существует")
        gid = cur.get("group_id") or None
        if stream and group:
            gid = ensure_training_group(conn, stream, group)
        conn.execute(
            """
            UPDATE cadets
            SET callsign=?, student_num=?, full_name=?, group_num=?, stream_num=?,
                group_id=?, phone=?, passport=?, note=?, content_hash=?
            WHERE id=?
            """,
            (call, num, fio, group, stream, gid, phone_s, passport_s, note_s, ch, cadet_id),
        )
    return get_cadet(cadet_id)


def get_cadet(cadet_id: str):
    with connect() as conn:
        row = conn.execute(
            """
            SELECT c.id, c.seq, c.callsign, c.student_num, c.full_name, c.group_num,
                   c.stream_num, c.group_id, c.phone, c.passport, c.note, c.content_hash,
                   c.created_at, c.owner_user_id, c.department_id,
                   g.classroom, g.polygon_name, g.tent_num, g.planned_count,
                   g.note AS group_note
            FROM cadets c
            LEFT JOIN training_groups g ON g.id=c.group_id
            WHERE c.id=?
            """,
            (cadet_id,),
        ).fetchone()
    return dict(row) if row else None


def cadet_hash_exists(content_hash: str, exclude_id: str = None) -> bool:
    h = (content_hash or "").strip()
    if not h:
        return False
    with connect() as conn:
        if exclude_id:
            row = conn.execute(
                "SELECT id FROM cadets WHERE content_hash=? AND id!=?",
                (h, exclude_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM cadets WHERE content_hash=?", (h,)
            ).fetchone()
    return bool(row)


def _renumber_cadets(conn):
    rows = conn.execute(
        "SELECT id FROM cadets ORDER BY seq ASC, created_at ASC"
    ).fetchall()
    for i, r in enumerate(rows, start=1):
        conn.execute("UPDATE cadets SET seq=? WHERE id=?", (i, r["id"]))


def remove_cadet(cadet_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM cadets WHERE id=?", (cadet_id,))
        if cur.rowcount <= 0:
            return False
        _renumber_cadets(conn)
    return True


def remove_cadets(cadet_ids) -> int:
    ids = [str(x) for x in (cadet_ids or []) if x]
    if not ids:
        return 0
    with connect() as conn:
        deleted = 0
        for cid in ids:
            cur = conn.execute("DELETE FROM cadets WHERE id=?", (cid,))
            deleted += cur.rowcount
        if deleted:
            _renumber_cadets(conn)
    return deleted


def clear_cadets_for_owner(owner_user_id: str) -> int:
    """Удалить всех курсантов, добавленных указанной учётной записью."""
    uid = (owner_user_id or "").strip()
    if not uid:
        return 0
    with connect() as conn:
        cur = conn.execute("DELETE FROM cadets WHERE owner_user_id=?", (uid,))
        deleted = cur.rowcount or 0
        if deleted:
            _renumber_cadets(conn)
    return deleted


def get_workload_month(year: int, month: int) -> dict:
    """Ячейки графика: { staff_id: { day_str: {code, hours} } }."""
    y, m = int(year), int(month)
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT staff_id, day, code, hours
            FROM workload_cells
            WHERE year=? AND month=?
            """,
            (y, m),
        ).fetchall()
    out = {}
    for r in rows:
        sid = r["staff_id"]
        out.setdefault(sid, {})[str(r["day"])] = {
            "code": r["code"] or "",
            "hours": r["hours"] or "",
        }
    return out


def get_workload_polygon(staff_id: str) -> dict:
    sid = (staff_id or "").strip()
    if not sid:
        return {"staff_id": "", "name": "", "date_from": "", "date_to": ""}
    with connect() as conn:
        row = conn.execute(
            """
            SELECT staff_id, name, date_from, date_to
            FROM workload_polygon WHERE staff_id=?
            """,
            (sid,),
        ).fetchone()
    if not row:
        return {"staff_id": sid, "name": "", "date_from": "", "date_to": ""}
    return dict(row)


def upsert_workload_polygon(
    staff_id: str,
    name: str = "",
    date_from: str = "",
    date_to: str = "",
) -> dict:
    sid = (staff_id or "").strip()
    if not sid:
        raise ValueError("Не указан сотрудник")
    name = (name or "").strip()
    date_from = (date_from or "").strip()
    date_to = (date_to or "").strip()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO workload_polygon(staff_id, name, date_from, date_to, updated_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(staff_id) DO UPDATE SET
              name=excluded.name,
              date_from=excluded.date_from,
              date_to=excluded.date_to,
              updated_at=excluded.updated_at
            """,
            (sid, name, date_from, date_to, _now()),
        )
    return get_workload_polygon(sid)


def upsert_workload_cell(
    year: int,
    month: int,
    staff_id: str,
    day: int,
    code: str = "",
    hours: str = "",
) -> dict:
    y, m, d = int(year), int(month), int(day)
    if m < 1 or m > 12:
        raise ValueError("Месяц: 1–12")
    if d < 1 or d > 31:
        raise ValueError("День: 1–31")
    sid = (staff_id or "").strip()
    if not sid:
        raise ValueError("Не указан сотрудник")
    code = (code or "").strip()
    hours = (hours or "").strip()
    if not code and not hours:
        with connect() as conn:
            conn.execute(
                "DELETE FROM workload_cells WHERE year=? AND month=? AND staff_id=? AND day=?",
                (y, m, sid, d),
            )
        return {"year": y, "month": m, "staff_id": sid, "day": d, "code": "", "hours": ""}
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO workload_cells(year, month, staff_id, day, code, hours, updated_at)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(year, month, staff_id, day) DO UPDATE SET
              code=excluded.code,
              hours=excluded.hours,
              updated_at=excluded.updated_at
            """,
            (y, m, sid, d, code, hours, _now()),
        )
    return {
        "year": y,
        "month": m,
        "staff_id": sid,
        "day": d,
        "code": code,
        "hours": hours,
    }


def _flight_sheet_out(row):
    if not row:
        return None
    d = dict(row)
    try:
        columns = json.loads(d.pop("columns_json") or "[]")
    except json.JSONDecodeError:
        columns = []
    try:
        rows = json.loads(d.pop("rows_json") or "[]")
    except json.JSONDecodeError:
        rows = []
    d["columns"] = columns
    d["rows"] = rows
    return d


def get_flight_sheet(user_id: str):
    if not user_id:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT user_id, source_name, columns_json, rows_json, updated_at FROM flight_sheets WHERE user_id=?",
            (user_id,),
        ).fetchone()
    return _flight_sheet_out(row)


def save_flight_sheet(user_id: str, source_name: str, columns, rows):
    payload_cols = json.dumps(columns, ensure_ascii=False)
    payload_rows = json.dumps(rows, ensure_ascii=False)
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO flight_sheets(user_id, source_name, columns_json, rows_json, updated_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET
              source_name=excluded.source_name,
              columns_json=excluded.columns_json,
              rows_json=excluded.rows_json,
              updated_at=excluded.updated_at
            """,
            (user_id, (source_name or "")[:180], payload_cols, payload_rows, _now()),
        )
    return get_flight_sheet(user_id)


def save_flight_sheet_rows(user_id: str, rows):
    current = get_flight_sheet(user_id)
    if not current:
        raise ValueError("Сначала загрузите шаблон полётной ведомости")
    return save_flight_sheet(user_id, current.get("source_name") or "", current.get("columns") or [], rows)


def delete_flight_sheet(user_id: str) -> bool:
    if not user_id:
        return False
    with connect() as conn:
        cur = conn.execute("DELETE FROM flight_sheets WHERE user_id=?", (user_id,))
        return cur.rowcount > 0


def list_library_docs(category: str):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, category, title, summary, original_name, stored_name, created_at
            FROM library_docs
            WHERE category=?
            ORDER BY created_at DESC
            """,
            (category,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_library_doc(doc_id: str):
    if not doc_id:
        return None
    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, category, title, summary, original_name, stored_name, created_at
            FROM library_docs WHERE id=?
            """,
            (doc_id,),
        ).fetchone()
    return dict(row) if row else None


def add_library_doc(category: str, title: str, summary: str, original_name: str, stored_name: str):
    doc_id = uuid.uuid4().hex
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO library_docs(id, category, title, summary, original_name, stored_name, created_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (doc_id, category, title, summary, original_name, stored_name, _now()),
        )
    return get_library_doc(doc_id)


def delete_library_doc(doc_id: str) -> bool:
    if not doc_id:
        return False
    with connect() as conn:
        cur = conn.execute("DELETE FROM library_docs WHERE id=?", (doc_id,))
        return cur.rowcount > 0
