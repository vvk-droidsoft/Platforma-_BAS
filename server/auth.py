# -*- coding: utf-8 -*-
"""Учётные записи, отделы, личный состав, токены сессий."""
import base64
import hashlib
import hmac
import os
import re
import secrets
import uuid
from typing import Any, Dict, List, Optional

from . import db
from . import features

ROLES = ("admin", "senior", "instructor", "assistant")
STAFF_ROLES = ("senior", "instructor", "assistant")

ROLE_LABELS = {
    "admin": "Администратор",
    "senior": "Старший инструктор",
    "instructor": "Инструктор",
    "assistant": "Ассистент инструктора",
}


def _now():
    return db._now()


def _hash_password(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        (password or "").encode("utf-8"),
        salt.encode("utf-8"),
        120000,
    )
    return f"{salt}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(_hash_password(password, salt), stored)


def _vault_key() -> bytes:
    secret = (
        os.environ.get("LIS_VAULT_KEY")
        or os.environ.get("MASTER_PASSWORD")
        or os.environ.get("ADMIN_PASSWORD")
        or "lis-admin-vault"
    )
    return hashlib.sha256(secret.encode("utf-8")).digest()


def _seal_password(password: str) -> str:
    """Обратимoe хранение пароля только для просмотра администратором."""
    data = (password or "").encode("utf-8")
    key = _vault_key()
    out = bytearray()
    counter = 0
    while len(out) < len(data):
        out.extend(hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    sealed = bytes(a ^ b for a, b in zip(data, out))
    return "v1:" + base64.urlsafe_b64encode(sealed).decode("ascii")


def _unseal_password(sealed: Optional[str]) -> str:
    if not sealed or not str(sealed).startswith("v1:"):
        return ""
    try:
        raw = base64.urlsafe_b64decode(str(sealed)[3:].encode("ascii"))
    except Exception:
        return ""
    key = _vault_key()
    out = bytearray()
    counter = 0
    while len(out) < len(raw):
        out.extend(hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    try:
        return bytes(a ^ b for a, b in zip(raw, out)).decode("utf-8")
    except Exception:
        return ""


def _write_password(conn, user_id: str, password: str, must_change: Optional[int] = None):
    vault = _seal_password(password)
    ph = _hash_password(password)
    if must_change is None:
        conn.execute(
            "UPDATE users SET password_hash=?, password_vault=? WHERE id=?",
            (ph, vault, user_id),
        )
    else:
        conn.execute(
            """
            UPDATE users SET password_hash=?, password_vault=?, must_change_password=?
            WHERE id=?
            """,
            (ph, vault, must_change, user_id),
        )


def init_auth_tables(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS departments (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS staff (
            id TEXT PRIMARY KEY,
            department_id TEXT NOT NULL,
            role TEXT NOT NULL,
            fio TEXT NOT NULL DEFAULT '',
            callsign TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY(department_id) REFERENCES departments(id)
        );
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            login TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            department_id TEXT,
            staff_id TEXT,
            display_name TEXT NOT NULL DEFAULT '',
            must_change_password INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            created_by TEXT
        );
        CREATE TABLE IF NOT EXISTS auth_tokens (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_staff_dept ON staff(department_id);
        CREATE INDEX IF NOT EXISTS idx_users_dept ON users(department_id);
        CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);
        """
    )
    # ownership на тестах / курсантах
    tcols = {r[1] for r in conn.execute("PRAGMA table_info(tests)").fetchall()}
    if "owner_user_id" not in tcols:
        conn.execute("ALTER TABLE tests ADD COLUMN owner_user_id TEXT")
    if "department_id" not in tcols:
        conn.execute("ALTER TABLE tests ADD COLUMN department_id TEXT")
    ccols = {r[1] for r in conn.execute("PRAGMA table_info(cadets)").fetchall()}
    if "owner_user_id" not in ccols:
        conn.execute("ALTER TABLE cadets ADD COLUMN owner_user_id TEXT")
    if "department_id" not in ccols:
        conn.execute("ALTER TABLE cadets ADD COLUMN department_id TEXT")
    ucols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "password_vault" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN password_vault TEXT")
    if "callsign" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN callsign TEXT NOT NULL DEFAULT ''")
    if "can_flight_sheet" not in ucols:
        conn.execute(
            "ALTER TABLE users ADD COLUMN can_flight_sheet INTEGER NOT NULL DEFAULT 0"
        )
        ucols.add("can_flight_sheet")
    if "is_tester" not in ucols:
        conn.execute(
            "ALTER TABLE users ADD COLUMN is_tester INTEGER NOT NULL DEFAULT 0"
        )
        # Перенос со старого флага полётки/библиотеки.
        conn.execute(
            "UPDATE users SET is_tester=1 WHERE COALESCE(can_flight_sheet,0)=1"
        )
    # Бывший hardcode «си_тестер» (кириллица: SQLite lower() ненадёжен).
    _legacy = "си_тестер"
    for row in conn.execute(
        "SELECT id, login, display_name, is_tester FROM users"
    ):
        if row["is_tester"]:
            continue
        login = (row["login"] or "").strip().casefold()
        name = (row["display_name"] or "").strip().casefold()
        if login == _legacy or name == _legacy:
            conn.execute(
                "UPDATE users SET is_tester=1 WHERE id=?",
                (row["id"],),
            )


def seed_admin(admin_password: str):
    """Создаёт или обновляет администратора admin."""
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE login=?", ("admin",)
        ).fetchone()
        if row:
            # не перезаписываем пароль, если уже есть пользователь —
            # только если нет ни одного admin
            return
        uid = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO users(
              id, login, password_hash, password_vault, role, department_id, staff_id,
              display_name, must_change_password, active, created_at, created_by
            ) VALUES(?,?,?,?,?,NULL,NULL,?,?,1,?,NULL)
            """,
            (
                uid,
                "admin",
                _hash_password(admin_password),
                _seal_password(admin_password),
                "admin",
                "Администратор",
                0,
                _now(),
            ),
        )


def ensure_admin_password(admin_password: str):
    """Если admin есть — оставить; если нет — создать. При пустой БД ролей — сверить env."""
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE login=?", ("admin",)
        ).fetchone()
        if not row:
            uid = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO users(
                  id, login, password_hash, password_vault, role, department_id, staff_id,
                  display_name, must_change_password, active, created_at, created_by
                ) VALUES(?,?,?,?,?,NULL,NULL,?,?,1,?,NULL)
                """,
                (
                    uid,
                    "admin",
                    _hash_password(admin_password),
                    _seal_password(admin_password),
                    "admin",
                    "Администратор",
                    0,
                    _now(),
                ),
            )
            return
        # если пароль из env не совпадает и это первый запуск со старым хешем —
        # не трогаем; админ меняет через UI


def public_user(row, *, include_password: bool = False) -> Dict[str, Any]:
    if not row:
        return {}
    d = dict(row) if not isinstance(row, dict) else dict(row)
    vault = d.pop("password_vault", None)
    d.pop("password_hash", None)
    d["role_label"] = ROLE_LABELS.get(d.get("role") or "", d.get("role") or "")
    d["must_change_password"] = bool(d.get("must_change_password"))
    d["is_tester"] = bool(d.get("is_tester") or d.get("can_flight_sheet"))
    # Совместимость со старым клиентом / localStorage.
    d["can_flight_sheet"] = d["is_tester"]
    d["modules"] = features.visible_modules(d)
    if include_password:
        d["password"] = _unseal_password(vault) or ""
    else:
        d.pop("password", None)
    d["active"] = bool(d.get("active", 1))
    return d


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return public_user(row) if row else None


def get_user_by_login(login: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE lower(login)=lower(?)",
            ((login or "").strip(),),
        ).fetchone()
    return dict(row) if row else None


def create_token(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO auth_tokens(token, user_id, created_at) VALUES(?,?,?)",
            (token, user_id, _now()),
        )
    return token


def revoke_token(token: str):
    with db.connect() as conn:
        conn.execute("DELETE FROM auth_tokens WHERE token=?", (token,))


def revoke_user_tokens(user_id: str):
    with db.connect() as conn:
        conn.execute("DELETE FROM auth_tokens WHERE user_id=?", (user_id,))


def user_from_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    with db.connect() as conn:
        row = conn.execute(
            """
            SELECT u.* FROM auth_tokens t
            JOIN users u ON u.id=t.user_id
            WHERE t.token=? AND u.active=1
            """,
            (token,),
        ).fetchone()
    return public_user(row) if row else None


def login(login_name: str, password: str) -> Dict[str, Any]:
    login_name = (login_name or "").strip()
    if not login_name:
        # совместимость: только пароль → admin
        login_name = "admin"
    row = get_user_by_login(login_name)
    if not row or not row.get("active", 1):
        raise ValueError("Неверный логин или пароль")
    if not _verify_password(password, row["password_hash"]):
        # совместимость со старым ADMIN_PASSWORD без миграции хеша
        env_pw = os.environ.get("ADMIN_PASSWORD", "admin")
        if (
            login_name.lower() == "admin"
            and password == env_pw
            and row["role"] == "admin"
        ):
            # обновить хеш на актуальный env-пароль
            with db.connect() as conn:
                _write_password(conn, row["id"], password)
        else:
            raise ValueError("Неверный логин или пароль")
    # заполнить vault при успешном входе, если ещё не сохранён (старые учётки)
    if not (row.get("password_vault") or "").strip():
        with db.connect() as conn:
            _write_password(conn, row["id"], password)
    token = create_token(row["id"])
    user = get_user(row["id"])
    return {"ok": True, "token": token, "user": user}


def change_password(user_id: str, old_password: str, new_password: str):
    row = get_user_by_login_id(user_id)
    if not row:
        raise ValueError("Пользователь не найден")
    if not _verify_password(old_password, row["password_hash"]):
        raise ValueError("Неверный текущий пароль")
    new_password = (new_password or "").strip()
    if len(new_password) < 4:
        raise ValueError("Новый пароль: минимум 4 символа")
    with db.connect() as conn:
        _write_password(conn, user_id, new_password, must_change=0)
    revoke_user_tokens(user_id)


def get_user_by_login_id(user_id: str):
    with db.connect() as conn:
        return conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()


def set_password(user_id: str, new_password: str, must_change: bool = True):
    new_password = (new_password or "").strip()
    if len(new_password) < 4:
        raise ValueError("Пароль: минимум 4 символа")
    with db.connect() as conn:
        _write_password(conn, user_id, new_password, must_change=1 if must_change else 0)
    revoke_user_tokens(user_id)


def gen_temp_password(length: int = 8) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# Кириллица → одна латинская буква (для пароля по инициалам)
_CYR_TO_LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "z", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "c", "ш": "s", "щ": "s", "ъ": "",
    "ы": "y", "ь": "", "э": "e", "ю": "y", "я": "y",
}


def _first_latin_letter(ch: str) -> str:
    if not ch:
        return ""
    c = ch[0]
    low = c.casefold()
    if "a" <= low <= "z":
        return low
    mapped = _CYR_TO_LAT.get(low, "")
    if mapped:
        return mapped[0]
    return ""


def login_from_fio(fio: str) -> str:
    """Логин = фамилия (первое слово ФИО) с заглавной буквы."""
    parts = [p for p in db._norm_fio(fio or "").split() if p]
    if not parts:
        return ""
    surname = parts[0]
    return surname[:1].upper() + surname[1:]


def password_from_staff(fio: str, role: str) -> str:
    """
    Пароль: 3 латинские буквы по инициалам ФИО + 1-я буква должности.
    Пример: «Курбатовв Валерий Владимирович» + assistant → kvva
    """
    parts = [p for p in db._norm_fio(fio or "").split() if p]
    initials: List[str] = []
    for p in parts[:3]:
        lat = _first_latin_letter(p)
        if lat:
            initials.append(lat)
    while len(initials) < 3:
        initials.append(initials[-1] if initials else "x")
    role_label = ROLE_LABELS.get(role or "", role or "")
    role_ch = _first_latin_letter(role_label) or "x"
    return "".join(initials[:3]) + role_ch


def credentials_from_staff(fio: str, role: str) -> Dict[str, str]:
    return {
        "login": login_from_fio(fio),
        "password": password_from_staff(fio, role),
    }


# ---------- departments / staff ----------
def _natural_name_key(name: str):
    """Сортировка: 1, 2, 3, 10, 17 (а не 1, 10, 17, 2)."""
    parts = re.split(r"(\d+)", (name or "").strip())
    key = []
    for p in parts:
        if not p:
            continue
        if p.isdigit():
            key.append((0, int(p)))
        else:
            key.append((1, p.casefold()))
    return key


def list_departments() -> List[Dict[str, Any]]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM departments").fetchall()
    out = [dict(r) for r in rows]
    out.sort(key=lambda d: _natural_name_key(d.get("name") or ""))
    return out


def create_department(name: str) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("Укажите название отдела")
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT 1 FROM departments WHERE lower(trim(name))=lower(?) LIMIT 1",
            (name,),
        ).fetchone()
        if exists:
            raise ValueError(f"Отдел {name} уже существует")
        did = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO departments(id, name, created_at) VALUES(?,?,?)",
            (did, name, _now()),
        )
    return {"id": did, "name": name}


def update_department(department_id: str, name: str) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("Укажите название отдела")
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id FROM departments WHERE id=?", (department_id,)
        ).fetchone()
        if not row:
            raise ValueError("Отдел не найден")
        exists = conn.execute(
            """
            SELECT 1 FROM departments
            WHERE lower(trim(name))=lower(?) AND id<>?
            LIMIT 1
            """,
            (name, department_id),
        ).fetchone()
        if exists:
            raise ValueError(f"Отдел {name} уже существует")
        conn.execute(
            "UPDATE departments SET name=? WHERE id=?",
            (name, department_id),
        )
    return {"id": department_id, "name": name}


def delete_department(department_id: str):
    with db.connect() as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM users WHERE department_id=?", (department_id,)
        ).fetchone()[0]
        if n:
            raise ValueError("Нельзя удалить отдел: есть учётные записи")
        conn.execute("DELETE FROM staff WHERE department_id=?", (department_id,))
        conn.execute("DELETE FROM departments WHERE id=?", (department_id,))


_STAFF_ROLE_ORDER = {"senior": 0, "instructor": 1, "assistant": 2}


def list_staff(department_id: Optional[str] = None) -> List[Dict[str, Any]]:
    with db.connect() as conn:
        if department_id:
            rows = conn.execute(
                """
                SELECT s.*, d.name AS department_name
                FROM staff s JOIN departments d ON d.id=s.department_id
                WHERE s.department_id=?
                ORDER BY
                  CASE s.role WHEN 'senior' THEN 0 WHEN 'instructor' THEN 1 ELSE 2 END,
                  s.fio COLLATE NOCASE
                """,
                (department_id,),
            ).fetchall()
        else:
            # порядок отделов — как в list_departments (1,2,3,8,11…), не лексикографически
            rows = conn.execute(
                """
                SELECT s.*, d.name AS department_name
                FROM staff s JOIN departments d ON d.id=s.department_id
                """
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["role_label"] = ROLE_LABELS.get(d["role"], d["role"])
        out.append(d)
    if not department_id:
        out.sort(
            key=lambda d: (
                _natural_name_key(d.get("department_name") or ""),
                _STAFF_ROLE_ORDER.get(d.get("role"), 9),
                (d.get("fio") or "").casefold(),
            )
        )
    return out


def add_staff(
    department_id: str, role: str, fio: str, callsign: str = ""
) -> Dict[str, Any]:
    if role not in STAFF_ROLES:
        raise ValueError("Роль: старший / инструктор / ассистент")
    fio = db._norm_fio(fio or "")
    if not fio:
        raise ValueError("Укажите ФИО")
    fio_key = fio.casefold()
    sid = uuid.uuid4().hex
    with db.connect() as conn:
        dep = conn.execute(
            "SELECT id FROM departments WHERE id=?", (department_id,)
        ).fetchone()
        if not dep:
            raise ValueError("Отдел не найден")
        for row in conn.execute("SELECT fio FROM staff").fetchall():
            if db._norm_fio(row["fio"] or "").casefold() == fio_key:
                raise ValueError("Сотрудник с таким ФИО уже есть в таблице")
        conn.execute(
            """
            INSERT INTO staff(id, department_id, role, fio, callsign, created_at)
            VALUES(?,?,?,?,?,?)
            """,
            (sid, department_id, role, fio, (callsign or "").strip(), _now()),
        )
    return {"id": sid, "department_id": department_id, "role": role, "fio": fio, "callsign": callsign}


def update_staff(
    staff_id: str,
    *,
    department_id: str,
    role: str,
    fio: str,
    callsign: str = "",
) -> Dict[str, Any]:
    if role not in STAFF_ROLES:
        raise ValueError("Роль: старший / инструктор / ассистент")
    fio = db._norm_fio(fio or "")
    if not fio:
        raise ValueError("Укажите ФИО")
    fio_key = fio.casefold()
    callsign = (callsign or "").strip()
    with db.connect() as conn:
        row = conn.execute("SELECT id FROM staff WHERE id=?", (staff_id,)).fetchone()
        if not row:
            raise ValueError("Сотрудник не найден")
        dep = conn.execute(
            "SELECT id FROM departments WHERE id=?", (department_id,)
        ).fetchone()
        if not dep:
            raise ValueError("Отдел не найден")
        for other in conn.execute(
            "SELECT id, fio FROM staff WHERE id<>?", (staff_id,)
        ).fetchall():
            if db._norm_fio(other["fio"] or "").casefold() == fio_key:
                raise ValueError("Сотрудник с таким ФИО уже есть в таблице")
        conn.execute(
            """
            UPDATE staff
            SET department_id=?, role=?, fio=?, callsign=?
            WHERE id=?
            """,
            (department_id, role, fio, callsign, staff_id),
        )
        # синхронизация отдела у привязанных учёток (не admin)
        conn.execute(
            """
            UPDATE users SET department_id=?
            WHERE staff_id=? AND role<>'admin'
            """,
            (department_id, staff_id),
        )
    out = get_staff(staff_id) or {}
    out["role_label"] = ROLE_LABELS.get(out.get("role"), out.get("role"))
    return out


def delete_staff(staff_id: str):
    with db.connect() as conn:
        conn.execute("UPDATE users SET staff_id=NULL WHERE staff_id=?", (staff_id,))
        conn.execute("DELETE FROM staff WHERE id=?", (staff_id,))


def get_staff(staff_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM staff WHERE id=?", (staff_id,)).fetchone()
    return dict(row) if row else None


# ---------- users CRUD ----------
def list_users(*, include_passwords: bool = False) -> List[Dict[str, Any]]:
    """Пароли (include_passwords) — только для ответа API администратора."""
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT u.*, d.name AS department_name, s.fio AS staff_fio,
              s.callsign AS staff_callsign,
              COALESCE(
                NULLIF(TRIM(s.callsign), ''),
                NULLIF(TRIM(u.callsign), ''),
                ''
              ) AS resolved_callsign
            FROM users u
            LEFT JOIN departments d ON d.id=u.department_id
            LEFT JOIN staff s ON s.id=u.staff_id
            ORDER BY
              CASE u.role WHEN 'admin' THEN 0 WHEN 'senior' THEN 1
                WHEN 'instructor' THEN 2 ELSE 3 END,
              u.login COLLATE NOCASE
            """
        ).fetchall()
    out = []
    for r in rows:
        d = public_user(r, include_password=include_passwords)
        d["callsign"] = (r["resolved_callsign"] if "resolved_callsign" in r.keys() else "") or ""
        d["staff_callsign"] = (r["staff_callsign"] if "staff_callsign" in r.keys() else "") or ""
        out.append(d)
    return out


def create_user(
    *,
    login_name: str,
    password: str,
    role: str,
    department_id: Optional[str] = None,
    staff_id: Optional[str] = None,
    display_name: str = "",
    must_change_password: bool = True,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    login_name = (login_name or "").strip()
    if not login_name:
        raise ValueError("Укажите логин")
    if role not in ROLES:
        raise ValueError("Неизвестная роль")
    if role != "admin" and not department_id:
        raise ValueError("Для этой роли нужен отдел")
    if role == "admin":
        department_id = None
        staff_id = None
    display_name = (display_name or "").strip()
    if staff_id:
        st = get_staff(staff_id)
        if not st:
            raise ValueError("Сотрудник не найден")
        if department_id and st["department_id"] != department_id:
            raise ValueError("Сотрудник из другого отдела")
        department_id = st["department_id"]
        if not display_name:
            display_name = st.get("fio") or ""
        # роль из базы ЛС, если не admin
        if role != "admin" and st["role"] in STAFF_ROLES:
            role = st["role"]
    if not display_name:
        display_name = login_name
    uid = uuid.uuid4().hex
    with db.connect() as conn:
        exists = conn.execute(
            "SELECT 1 FROM users WHERE lower(login)=lower(?)", (login_name,)
        ).fetchone()
        if exists:
            raise ValueError("Такой логин уже есть")
        if department_id:
            dep = conn.execute(
                "SELECT 1 FROM departments WHERE id=?", (department_id,)
            ).fetchone()
            if not dep:
                raise ValueError("Отдел не найден")
        conn.execute(
            """
            INSERT INTO users(
              id, login, password_hash, password_vault, role, department_id, staff_id,
              display_name, must_change_password, active, created_at, created_by
            ) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)
            """,
            (
                uid,
                login_name,
                _hash_password(password),
                _seal_password(password),
                role,
                department_id,
                staff_id,
                display_name,
                1 if must_change_password else 0,
                _now(),
                created_by,
            ),
        )
    return get_user(uid)


def create_users_from_all_staff(*, created_by: Optional[str] = None) -> Dict[str, Any]:
    """
    Создать учётные записи для всего личного состава.
    Логин/пароль — по правилам credentials_from_staff.
    Дубликаты логина и уже привязанные сотрудники пропускаются.
    """
    staff_list = list_staff()
    with db.connect() as conn:
        existing_logins = {
            (r["login"] or "").casefold()
            for r in conn.execute("SELECT login FROM users").fetchall()
            if (r["login"] or "").strip()
        }
        linked_staff = {
            r["staff_id"]
            for r in conn.execute(
                "SELECT staff_id FROM users WHERE staff_id IS NOT NULL AND TRIM(staff_id)<>''"
            ).fetchall()
        }
    seen_logins = set()
    created = []
    duplicates = []
    for st in staff_list:
        sid = st.get("id") or ""
        fio = db._norm_fio(st.get("fio") or "")
        role = st.get("role") or "assistant"
        role_label = ROLE_LABELS.get(role, role)
        dep_name = (st.get("department_name") or "").strip() or "—"
        creds = credentials_from_staff(fio, role)
        login = creds["login"]
        password = creds["password"]
        login_key = login.casefold() if login else ""
        base = {
            "fio": fio,
            "login": login,
            "password": password,
            "role": role_label,
            "department": dep_name,
        }
        if sid and sid in linked_staff:
            duplicates.append({**base, "reason": "учётная запись уже есть"})
            continue
        if not login_key:
            duplicates.append({**base, "reason": "не удалось сформировать логин"})
            continue
        if login_key in existing_logins:
            duplicates.append({**base, "reason": "логин уже есть"})
            continue
        if login_key in seen_logins:
            duplicates.append({**base, "reason": "повтор логина в списке ЛС"})
            continue
        try:
            user = create_user(
                login_name=login,
                password=password,
                role=role if role in STAFF_ROLES else "assistant",
                department_id=st.get("department_id"),
                staff_id=sid,
                display_name=fio,
                must_change_password=True,
                created_by=created_by,
            )
            created.append(
                {
                    "id": user.get("id"),
                    "login": login,
                    "password": password,
                    "fio": fio,
                    "role": role_label,
                    "department": dep_name,
                }
            )
            seen_logins.add(login_key)
            existing_logins.add(login_key)
            if sid:
                linked_staff.add(sid)
        except ValueError as err:
            duplicates.append({**base, "reason": str(err)})
    return {
        "ok": True,
        "created": len(created),
        "skipped": len(duplicates),
        "users": created,
        "duplicates": duplicates,
    }


def update_user(
    user_id: str,
    *,
    login_name: str,
    display_name: str = "",
    role: str,
    department_id: Optional[str] = None,
    callsign: Optional[str] = None,
    password: Optional[str] = None,
    must_change_password: bool = True,
    can_flight_sheet: Optional[bool] = None,
    is_tester: Optional[bool] = None,
    actor_id: Optional[str] = None,
) -> Dict[str, Any]:
    login_name = (login_name or "").strip()
    display_name = (display_name or "").strip()
    if not login_name:
        raise ValueError("Укажите логин")
    if role not in ROLES:
        raise ValueError("Неизвестная роль")
    cur = get_user(user_id)
    if not cur:
        raise ValueError("Пользователь не найден")
    if role != "admin" and not department_id:
        raise ValueError("Для этой роли нужен отдел")
    if role == "admin":
        department_id = None
    # нельзя снять последнего admin
    if cur.get("role") == "admin" and role != "admin":
        with db.connect() as conn:
            n = conn.execute(
                "SELECT COUNT(*) FROM users WHERE role='admin' AND active=1"
            ).fetchone()[0]
        if n <= 1:
            raise ValueError("Нельзя снять роль с последнего администратора")
    if not display_name:
        display_name = login_name
    new_password = (password or "").strip() if password is not None else ""
    if password is not None and new_password and len(new_password) < 4:
        raise ValueError("Пароль: минимум 4 символа")
    call_n = None
    if callsign is not None:
        call_n = (callsign or "").strip()
    with db.connect() as conn:
        exists = conn.execute(
            """
            SELECT 1 FROM users WHERE lower(login)=lower(?) AND id<>?
            """,
            (login_name, user_id),
        ).fetchone()
        if exists:
            raise ValueError("Такой логин уже есть")
        if department_id:
            dep = conn.execute(
                "SELECT 1 FROM departments WHERE id=?", (department_id,)
            ).fetchone()
            if not dep:
                raise ValueError("Отдел не найден")
        staff_id = cur.get("staff_id")
        if role == "admin":
            staff_id = None
        elif staff_id:
            st = conn.execute(
                "SELECT department_id FROM staff WHERE id=?", (staff_id,)
            ).fetchone()
            if not st or st["department_id"] != department_id:
                staff_id = None
        if call_n is not None:
            conn.execute(
                """
                UPDATE users
                SET login=?, display_name=?, role=?, department_id=?, staff_id=?, callsign=?
                WHERE id=?
                """,
                (
                    login_name,
                    display_name,
                    role,
                    department_id,
                    staff_id,
                    call_n,
                    user_id,
                ),
            )
            if staff_id:
                conn.execute(
                    "UPDATE staff SET callsign=? WHERE id=?",
                    (call_n, staff_id),
                )
        else:
            conn.execute(
                """
                UPDATE users
                SET login=?, display_name=?, role=?, department_id=?, staff_id=?
                WHERE id=?
                """,
                (login_name, display_name, role, department_id, staff_id, user_id),
            )
        tester_flag = is_tester if is_tester is not None else can_flight_sheet
        if tester_flag is not None:
            flag = 1 if tester_flag else 0
            conn.execute(
                "UPDATE users SET is_tester=?, can_flight_sheet=? WHERE id=?",
                (flag, flag, user_id),
            )
        if new_password:
            _write_password(
                conn, user_id, new_password, must_change=1 if must_change_password else 0
            )
    # смена роли/логина/пароля — перелогин (кроме правки себя без смены пароля)
    if actor_id != user_id or new_password:
        revoke_user_tokens(user_id)
    # вернуть с позывным как в list_users
    for u in list_users(include_passwords=True):
        if u.get("id") == user_id:
            return u
    return get_user(user_id)


def set_user_active(user_id: str, active: bool):
    with db.connect() as conn:
        conn.execute(
            "UPDATE users SET active=? WHERE id=?",
            (1 if active else 0, user_id),
        )
    if not active:
        revoke_user_tokens(user_id)


def delete_user(user_id: str, actor_id: str):
    if user_id == actor_id:
        raise ValueError("Нельзя удалить себя")
    u = get_user(user_id)
    if not u:
        raise ValueError("Пользователь не найден")
    if u["role"] == "admin":
        with db.connect() as conn:
            n = conn.execute(
                "SELECT COUNT(*) FROM users WHERE role='admin' AND active=1"
            ).fetchone()[0]
        if n <= 1:
            raise ValueError("Нельзя удалить последнего администратора")
    revoke_user_tokens(user_id)
    with db.connect() as conn:
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))


# ---------- visibility ----------
def can_access_test(user: Dict[str, Any], test: Dict[str, Any]) -> bool:
    if not user or not test:
        return False
    if user.get("role") == "admin":
        return True
    if user.get("role") == "senior":
        return bool(
            user.get("department_id")
            and test.get("department_id")
            and user["department_id"] == test["department_id"]
        )
    return test.get("owner_user_id") == user.get("id")


def filter_tests_for_user(user: Dict[str, Any], tests: List[Dict[str, Any]]):
    return [t for t in tests if can_access_test(user, t)]


def visible_test_ids(user: Dict[str, Any]) -> Optional[List[str]]:
    """None = все тесты (admin)."""
    if user.get("role") == "admin":
        return None
    tests = db.list_tests()
    return [t["id"] for t in tests if can_access_test(user, t)]


def can_access_cadet(user: Dict[str, Any], cadet: Dict[str, Any]) -> bool:
    """Просмотр: все авторизованные видят всю таблицу курсантов."""
    return bool(user)


def can_modify_cadet(user: Dict[str, Any], cadet: Dict[str, Any]) -> bool:
    """Удаление/редактирование: только владелец записи или администратор."""
    if not user or not cadet:
        return False
    if user.get("role") == "admin":
        return True
    return cadet.get("owner_user_id") == user.get("id")
