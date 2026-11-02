# -*- coding: utf-8 -*-
"""Экзамены: свободные текстовые ответы, проверка преподавателем."""
from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional

from . import db


def ensure_tables(conn=None) -> None:
    owns = conn is None
    if owns:
        ctx = db.connect()
        conn = ctx.__enter__()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS exams (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              require_roster INTEGER NOT NULL DEFAULT 1,
              timer_minutes INTEGER,
              master_password TEXT NOT NULL DEFAULT '',
              published_for_all INTEGER NOT NULL DEFAULT 0,
              questions_count INTEGER,
              owner_user_id TEXT,
              department_id TEXT
            );
            CREATE TABLE IF NOT EXISTS exam_questions (
              id TEXT PRIMARY KEY,
              exam_id TEXT NOT NULL,
              npp INTEGER NOT NULL,
              text TEXT NOT NULL,
              FOREIGN KEY(exam_id) REFERENCES exams(id)
            );
            CREATE INDEX IF NOT EXISTS idx_exam_questions_exam
              ON exam_questions(exam_id, npp);
            CREATE TABLE IF NOT EXISTS exam_roster (
              exam_id TEXT NOT NULL,
              student_num TEXT NOT NULL,
              callsign TEXT NOT NULL DEFAULT '',
              full_name TEXT NOT NULL DEFAULT '',
              group_num TEXT NOT NULL DEFAULT '',
              stream_num TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              PRIMARY KEY(exam_id, student_num),
              FOREIGN KEY(exam_id) REFERENCES exams(id)
            );
            CREATE TABLE IF NOT EXISTS exam_attempts (
              id TEXT PRIMARY KEY,
              exam_id TEXT NOT NULL,
              student_num TEXT NOT NULL,
              callsign TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              finished_at TEXT,
              duration_sec INTEGER,
              start_id TEXT,
              submit_id TEXT,
              grade TEXT,
              teacher_comment TEXT NOT NULL DEFAULT '',
              graded_by_user_id TEXT,
              graded_at TEXT,
              answers_json TEXT,
              FOREIGN KEY(exam_id) REFERENCES exams(id)
            );
            CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam
              ON exam_attempts(exam_id);
            CREATE INDEX IF NOT EXISTS idx_exam_attempts_num
              ON exam_attempts(exam_id, student_num);
            """
        )
    finally:
        if owns:
            ctx.__exit__(None, None, None)


def _brief_exam(row: Dict[str, Any], *, include_master: bool = False) -> Dict[str, Any]:
    d = dict(row)
    pwd = (d.pop("master_password", None) or "").strip()
    d["has_master_password"] = bool(pwd)
    d["published_for_all"] = bool(d.get("published_for_all"))
    d["require_roster"] = bool(d.get("require_roster", 1))
    if include_master:
        d["master_password"] = pwd
    return d


def _load_questions(conn, exam_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, exam_id, npp, text
        FROM exam_questions WHERE exam_id=?
        ORDER BY npp ASC, rowid ASC
        """,
        (exam_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _replace_questions(conn, exam_id: str, questions: List[str]) -> int:
    conn.execute("DELETE FROM exam_questions WHERE exam_id=?", (exam_id,))
    n = 0
    for i, raw in enumerate(questions or [], 1):
        text = str(raw or "").strip()
        if not text:
            continue
        n += 1
        conn.execute(
            """
            INSERT INTO exam_questions(id, exam_id, npp, text)
            VALUES(?,?,?,?)
            """,
            (uuid.uuid4().hex, exam_id, n, text),
        )
    conn.execute(
        "UPDATE exams SET questions_count=? WHERE id=?",
        (n if n else None, exam_id),
    )
    return n


def create_exam(
    title: str,
    questions: List[str],
    *,
    timer_minutes: int = 40,
    owner_user_id: str = None,
    department_id: str = None,
    master_password: str = "",
    published_for_all: bool = False,
    require_roster: bool = True,
) -> Dict[str, Any]:
    title = (title or "").strip()
    if not title:
        raise ValueError("Укажите название экзамена")
    cleaned = [str(q or "").strip() for q in (questions or []) if str(q or "").strip()]
    if not cleaned:
        raise ValueError("Добавьте хотя бы один вопрос")
    eid = uuid.uuid4().hex[:12]
    with db.connect() as conn:
        ensure_tables(conn)
        conn.execute(
            """
            INSERT INTO exams(
              id, title, created_at, require_roster, timer_minutes,
              owner_user_id, department_id, master_password, published_for_all,
              questions_count
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
            """,
            (
                eid,
                title,
                db._now(),
                1 if require_roster else 0,
                int(timer_minutes) if timer_minutes else None,
                owner_user_id,
                department_id,
                (master_password or "").strip(),
                1 if published_for_all else 0,
                len(cleaned),
            ),
        )
        _replace_questions(conn, eid, cleaned)
    return get_exam(eid, include_questions=True) or {"id": eid}


def update_exam(
    exam_id: str,
    *,
    title: Optional[str] = None,
    timer_minutes: Optional[int] = None,
    master_password: Optional[str] = None,
    published_for_all: Optional[bool] = None,
    questions: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        ensure_tables(conn)
        row = conn.execute("SELECT * FROM exams WHERE id=?", (exam_id,)).fetchone()
        if not row:
            return None
        if title is not None:
            t = title.strip()
            if not t:
                raise ValueError("Название не может быть пустым")
            conn.execute("UPDATE exams SET title=? WHERE id=?", (t, exam_id))
        if timer_minutes is not None:
            conn.execute(
                "UPDATE exams SET timer_minutes=? WHERE id=?",
                (int(timer_minutes) if timer_minutes else None, exam_id),
            )
        if master_password is not None:
            conn.execute(
                "UPDATE exams SET master_password=? WHERE id=?",
                (master_password.strip(), exam_id),
            )
        if published_for_all is not None:
            conn.execute(
                "UPDATE exams SET published_for_all=? WHERE id=?",
                (1 if published_for_all else 0, exam_id),
            )
        if questions is not None:
            cleaned = [str(q or "").strip() for q in questions if str(q or "").strip()]
            if not cleaned:
                raise ValueError("Добавьте хотя бы один вопрос")
            _replace_questions(conn, exam_id, cleaned)
    return get_exam(exam_id, include_questions=True)


def delete_exam(exam_id: str) -> bool:
    with db.connect() as conn:
        ensure_tables(conn)
        row = conn.execute("SELECT id FROM exams WHERE id=?", (exam_id,)).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM exam_questions WHERE exam_id=?", (exam_id,))
        conn.execute("DELETE FROM exam_roster WHERE exam_id=?", (exam_id,))
        conn.execute("DELETE FROM exam_attempts WHERE exam_id=?", (exam_id,))
        conn.execute("DELETE FROM exams WHERE id=?", (exam_id,))
    return True


def get_exam(
    exam_id: str,
    *,
    include_questions: bool = False,
    include_master: bool = False,
) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        ensure_tables(conn)
        row = conn.execute(
            """
            SELECT e.*,
              u.display_name AS owner_name, u.login AS owner_login, u.role AS owner_role,
              d.name AS department_name,
              (SELECT COUNT(*) FROM exam_roster r WHERE r.exam_id=e.id) AS roster_count,
              (SELECT COUNT(*) FROM exam_attempts a
                 WHERE a.exam_id=e.id AND a.status='finished') AS finished_count
            FROM exams e
            LEFT JOIN users u ON u.id=e.owner_user_id
            LEFT JOIN departments d ON d.id=e.department_id
            WHERE e.id=?
            """,
            (exam_id,),
        ).fetchone()
        if not row:
            return None
        d = _brief_exam(dict(row), include_master=include_master)
        if include_questions:
            d["questions"] = _load_questions(conn, exam_id)
    return d


def list_exams(*, include_master: bool = False) -> List[Dict[str, Any]]:
    with db.connect() as conn:
        ensure_tables(conn)
        rows = conn.execute(
            """
            SELECT e.*,
              u.display_name AS owner_name, u.login AS owner_login, u.role AS owner_role,
              d.name AS department_name,
              (SELECT COUNT(*) FROM exam_roster r WHERE r.exam_id=e.id) AS roster_count,
              (SELECT COUNT(*) FROM exam_attempts a
                 WHERE a.exam_id=e.id AND a.status='finished') AS finished_count
            FROM exams e
            LEFT JOIN users u ON u.id=e.owner_user_id
            LEFT JOIN departments d ON d.id=e.department_id
            ORDER BY e.created_at DESC
            """
        ).fetchall()
    return [_brief_exam(dict(r), include_master=include_master) for r in rows]


def list_published_catalog() -> List[Dict[str, Any]]:
    with db.connect() as conn:
        ensure_tables(conn)
        rows = conn.execute(
            """
            SELECT e.*,
              u.display_name AS owner_name, u.login AS owner_login, u.role AS owner_role,
              d.name AS department_name
            FROM exams e
            LEFT JOIN users u ON u.id=e.owner_user_id
            LEFT JOIN departments d ON d.id=e.department_id
            WHERE COALESCE(e.published_for_all, 0)=1 AND u.role='senior'
            ORDER BY e.created_at DESC
            """
        ).fetchall()
    return [_brief_exam(dict(r)) for r in rows]


def adopt_exam(exam_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    src = get_exam(exam_id, include_questions=True)
    if not src:
        raise ValueError("Экзамен не найден")
    if not src.get("published_for_all"):
        raise ValueError("Экзамен не опубликован для всех")
    qs = [q.get("text") or "" for q in (src.get("questions") or [])]
    return create_exam(
        title=src.get("title") or "Экзамен",
        questions=qs,
        timer_minutes=int(src.get("timer_minutes") or 40),
        owner_user_id=user.get("id"),
        department_id=user.get("department_id"),
        published_for_all=False,
    )


def get_roster(exam_id: str) -> List[Dict[str, Any]]:
    with db.connect() as conn:
        ensure_tables(conn)
        rows = conn.execute(
            """
            SELECT * FROM exam_roster WHERE exam_id=?
            ORDER BY student_num ASC
            """,
            (exam_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def add_roster_entry(
    exam_id: str,
    student_num: str,
    *,
    callsign: str = "",
    full_name: str = "",
    group_num: str = "",
    stream_num: str = "",
) -> Dict[str, Any]:
    num = db._norm_call(student_num)
    if not num:
        raise ValueError("Укажите номер курсанта")
    with db.connect() as conn:
        ensure_tables(conn)
        if not conn.execute("SELECT id FROM exams WHERE id=?", (exam_id,)).fetchone():
            raise ValueError("Экзамен не найден")
        conn.execute(
            """
            INSERT INTO exam_roster(
              exam_id, student_num, callsign, full_name, group_num, stream_num, created_at
            ) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(exam_id, student_num) DO UPDATE SET
              callsign=excluded.callsign,
              full_name=excluded.full_name,
              group_num=excluded.group_num,
              stream_num=excluded.stream_num
            """,
            (
                exam_id,
                num,
                (callsign or "").strip(),
                (full_name or "").strip(),
                (group_num or "").strip(),
                (stream_num or "").strip(),
                db._now(),
            ),
        )
    return {
        "student_num": num,
        "callsign": (callsign or "").strip(),
        "full_name": (full_name or "").strip(),
        "group_num": (group_num or "").strip(),
        "stream_num": (stream_num or "").strip(),
    }


def remove_roster_entry(exam_id: str, student_num: str) -> bool:
    num = db._norm_call(student_num)
    with db.connect() as conn:
        ensure_tables(conn)
        cur = conn.execute(
            "DELETE FROM exam_roster WHERE exam_id=? AND student_num=?",
            (exam_id, num),
        )
        return cur.rowcount > 0


def can_start(exam_id: str, student_num: str, callsign: str = "") -> Dict[str, Any]:
    exam = get_exam(exam_id)
    if not exam:
        return {"ok": False, "reason": "Экзамен не найден"}
    num = db._norm_call(student_num)
    call = (callsign or "").strip()
    with db.connect() as conn:
        ensure_tables(conn)
        if exam.get("require_roster"):
            row = conn.execute(
                "SELECT * FROM exam_roster WHERE exam_id=? AND student_num=?",
                (exam_id, num),
            ).fetchone()
            if not row:
                return {"ok": False, "reason": "Номер не в списке допуска"}
            expected = (row["callsign"] or "").strip()
            if expected and call and expected.lower() != call.lower():
                return {"ok": False, "reason": "Позывной не совпадает со списком"}
            if expected and not call:
                return {"ok": False, "reason": "Введите позывной"}
        att = conn.execute(
            """
            SELECT id, status FROM exam_attempts
            WHERE exam_id=? AND student_num=?
            ORDER BY created_at DESC LIMIT 1
            """,
            (exam_id, num),
        ).fetchone()
        if att and att["status"] in ("started", "finished"):
            return {
                "ok": False,
                "reason": "Попытка уже есть",
                "status": att["status"],
                "attempt_id": att["id"],
            }
    return {
        "ok": True,
        "title": exam.get("title"),
        "timer_minutes": exam.get("timer_minutes"),
        "questions_count": exam.get("questions_count"),
    }


def begin_attempt(
    exam_id: str, student_num: str, callsign: str = "", start_id: str = ""
) -> Dict[str, Any]:
    check = can_start(exam_id, student_num, callsign)
    if not check.get("ok"):
        raise ValueError(check.get("reason") or "Нельзя начать")
    exam = get_exam(exam_id, include_questions=True)
    if not exam:
        raise ValueError("Экзамен не найден")
    num = db._norm_call(student_num)
    aid = uuid.uuid4().hex
    with db.connect() as conn:
        ensure_tables(conn)
        conn.execute(
            """
            INSERT INTO exam_attempts(
              id, exam_id, student_num, callsign, status, created_at, start_id
            ) VALUES(?,?,?,?,?,?,?)
            """,
            (
                aid,
                exam_id,
                num,
                (callsign or "").strip(),
                "started",
                db._now(),
                (start_id or "").strip() or None,
            ),
        )
    return {
        "attempt_id": aid,
        "exam": {
            "id": exam["id"],
            "title": exam["title"],
            "timer_minutes": exam.get("timer_minutes"),
            "questions": [
                {"id": q["id"], "npp": q["npp"], "text": q["text"]}
                for q in (exam.get("questions") or [])
            ],
        },
    }


def submit_attempt(
    exam_id: str,
    *,
    student_num: str,
    callsign: str = "",
    answers: List[Dict[str, Any]],
    duration_sec: Optional[int] = None,
    start_id: str = "",
    submit_id: str = "",
) -> Dict[str, Any]:
    num = db._norm_call(student_num)
    exam = get_exam(exam_id, include_questions=True)
    if not exam:
        raise ValueError("Экзамен не найден")
    qmap = {q["id"]: q for q in (exam.get("questions") or [])}
    saved = []
    for a in answers or []:
        qid = (a.get("question_id") or a.get("id") or "").strip()
        if qid not in qmap:
            continue
        text = str(a.get("answer_text") or a.get("text") or "").strip()
        q = qmap[qid]
        saved.append(
            {
                "question_id": qid,
                "npp": q["npp"],
                "q": q["text"],
                "answer_text": text,
            }
        )
    saved.sort(key=lambda x: int(x.get("npp") or 0))
    with db.connect() as conn:
        ensure_tables(conn)
        att = conn.execute(
            """
            SELECT * FROM exam_attempts
            WHERE exam_id=? AND student_num=?
            ORDER BY created_at DESC LIMIT 1
            """,
            (exam_id, num),
        ).fetchone()
        if not att:
            raise ValueError("Сначала начните экзамен")
        if att["status"] == "finished" and submit_id and att["submit_id"] == submit_id:
            return _attempt_out(dict(att), exam_title=exam.get("title"))
        if att["status"] == "finished":
            raise ValueError("Экзамен уже сдан")
        if start_id and att["start_id"] and att["start_id"] != start_id:
            raise ValueError("Сессия устарела — обновите страницу")
        conn.execute(
            """
            UPDATE exam_attempts SET
              status='finished',
              finished_at=?,
              duration_sec=?,
              submit_id=?,
              callsign=COALESCE(NULLIF(?, ''), callsign),
              answers_json=?
            WHERE id=?
            """,
            (
                db._now(),
                int(duration_sec) if duration_sec is not None else None,
                (submit_id or "").strip() or None,
                (callsign or "").strip(),
                json.dumps(saved, ensure_ascii=False),
                att["id"],
            ),
        )
        row = conn.execute(
            "SELECT * FROM exam_attempts WHERE id=?", (att["id"],)
        ).fetchone()
    return _attempt_out(dict(row), exam_title=exam.get("title"))


def _attempt_out(row: Dict[str, Any], exam_title: str = "") -> Dict[str, Any]:
    d = dict(row)
    try:
        answers = json.loads(d.get("answers_json") or "[]")
    except Exception:
        answers = []
    if not isinstance(answers, list):
        answers = []
    d["answers"] = answers
    d.pop("answers_json", None)
    d["exam_title"] = exam_title or d.get("exam_title") or ""
    d["answered_count"] = sum(
        1 for a in answers if str(a.get("answer_text") or "").strip()
    )
    d["questions_count"] = len(answers)
    d["awaiting_review"] = d.get("status") == "finished" and not (d.get("grade") or "").strip()
    return d


def list_attempts(exam_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    with db.connect() as conn:
        ensure_tables(conn)
        sql = """
            SELECT a.*, e.title AS exam_title,
              r.full_name, r.group_num, r.stream_num
            FROM exam_attempts a
            JOIN exams e ON e.id=a.exam_id
            LEFT JOIN exam_roster r
              ON r.exam_id=a.exam_id AND r.student_num=a.student_num
        """
        args: List[Any] = []
        if exam_ids is not None:
            if not exam_ids:
                return []
            placeholders = ",".join("?" for _ in exam_ids)
            sql += f" WHERE a.exam_id IN ({placeholders})"
            args.extend(exam_ids)
        sql += " ORDER BY COALESCE(a.finished_at, a.created_at) DESC"
        rows = conn.execute(sql, args).fetchall()
    return [_attempt_out(dict(r), exam_title=r["exam_title"]) for r in rows]


def get_attempt(attempt_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        ensure_tables(conn)
        row = conn.execute(
            """
            SELECT a.*, e.title AS exam_title,
              r.full_name, r.group_num, r.stream_num
            FROM exam_attempts a
            JOIN exams e ON e.id=a.exam_id
            LEFT JOIN exam_roster r
              ON r.exam_id=a.exam_id AND r.student_num=a.student_num
            WHERE a.id=?
            """,
            (attempt_id,),
        ).fetchone()
        if not row:
            return None
        d = _attempt_out(dict(row), exam_title=row["exam_title"])
        d["questions"] = _load_questions(conn, row["exam_id"])
    return d


def set_attempt_grade(
    attempt_id: str,
    grade: str,
    comment: str = "",
    graded_by_user_id: str = "",
) -> Optional[Dict[str, Any]]:
    g = str(grade or "").strip()
    if not g:
        raise ValueError("Укажите оценку")
    with db.connect() as conn:
        ensure_tables(conn)
        row = conn.execute(
            "SELECT id FROM exam_attempts WHERE id=?", (attempt_id,)
        ).fetchone()
        if not row:
            return None
        conn.execute(
            """
            UPDATE exam_attempts SET
              grade=?,
              teacher_comment=?,
              graded_by_user_id=?,
              graded_at=?
            WHERE id=?
            """,
            (
                g,
                (comment or "").strip(),
                graded_by_user_id or None,
                db._now(),
                attempt_id,
            ),
        )
    return get_attempt(attempt_id)
