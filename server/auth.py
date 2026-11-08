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

# Справочник должностей ЛС (таблица job_titles). Базовые коды завязаны на ACL распределений/хаба —
# их нельзя архивировать; названия можно править.
CORE_JOB_TITLES = (
    ("senior", "Старший инструктор", "СИ", 0),
    ("instructor", "Инструктор", "И", 1),
    ("assistant", "Ассистент инструктора", "АИ", 2),
)
_CORE_SHORT = {code: short for code, _name, short, _order in CORE_JOB_TITLES}


def _now():
    return db._now()


def _job_title_names(conn=None) -> Dict[str, str]:
    """code → name из job_titles (включая архивные: у старых записей подпись сохраняется)."""
    try:
        if conn is not None:
            rows = conn.execute("SELECT code, name FROM job_titles").fetchall()
        else:
            with db.connect() as c:
                rows = c.execute("SELECT code, name FROM job_titles").fetchall()
    except Exception:
        return {}
    return {r["code"]: r["name"] for r in rows if r["code"]}


def role_label(code: str, names: Optional[Dict[str, str]] = None) -> str:
    """Подпись должности: job_titles.name → ROLE_LABELS → сам код."""
    code = code or ""
    if names is None:
        names = _job_title_names()
    return names.get(code) or ROLE_LABELS.get(code) or code


def job_title_short(code: str, name: str = "") -> str:
    """Короткая подпись для счётчиков: СИ/И/АИ для базовых, иначе инициалы слов названия."""
    if code in _CORE_SHORT:
        return _CORE_SHORT[code]
    words = [w for w in re.split(r"[\s\-_/]+", (name or "").strip()) if w]
    short = "".join(w[0].upper() for w in words[:3])
    return short or (code or "?")[:3].upper()


# Хеш для входа: только проверка, необратим.
# Формат v2: pbkdf2_sha256$<iter>$<salt_hex>$<dk_hex>
# Формат v1 (старый): <salt_hex>$<dk_hex> при 120000 итерациях.
_PBKDF2_ITERS = 210_000
_PBKDF2_ITERS_LEGACY = 120_000


def _hash_password(password: str, salt: Optional[str] = None, *, iterations: int = _PBKDF2_ITERS) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        (password or "").encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations),
    )
    return f"pbkdf2_sha256${int(iterations)}${salt}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    if not stored or "$" not in stored:
        return False
    parts = stored.split("$")
    if parts[0] == "pbkdf2_sha256" and len(parts) == 4:
        try:
            iterations = int(parts[1])
        except ValueError:
            return False
        salt, dk_hex = parts[2], parts[3]
        probe = hashlib.pbkdf2_hmac(
            "sha256",
            (password or "").encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        ).hex()
        return hmac.compare_digest(probe, dk_hex)
    # legacy: salt$hex
    if len(parts) == 2:
        salt, dk_hex = parts
        probe = hashlib.pbkdf2_hmac(
            "sha256",
            (password or "").encode("utf-8"),
            salt.encode("utf-8"),
            _PBKDF2_ITERS_LEGACY,
        ).hex()
        return hmac.compare_digest(probe, dk_hex)
    return False


def _password_needs_rehash(stored: str) -> bool:
    """Старый формат или меньше целевых итераций — перехешировать при входе."""
    if not stored or not stored.startswith("pbkdf2_sha256$"):
        return True
    parts = stored.split("$")
    if len(parts) != 4:
        return True
    try:
        return int(parts[1]) < _PBKDF2_ITERS
    except ValueError:
        return True


def _derive_key_material(secret: str) -> bytes:
    return hashlib.sha256((secret or "").encode("utf-8")).digest()


def _vault_key_file() -> str:
    return os.path.join(db.DATA_DIR, ".lis_vault_key")


def _vault_key() -> bytes:
    """Ключ обратимого vault (просмотр пароля админом).

    Приоритет: LIS_VAULT_KEY → файл в DATA_DIR → создать файл.
    Больше не берём ADMIN_PASSWORD: смена пароля админа ломала расшифровку всех учёток.
    """
    env = (os.environ.get("LIS_VAULT_KEY") or "").strip()
    if env:
        return _derive_key_material(env)
    path = _vault_key_file()
    try:
        os.makedirs(db.DATA_DIR, exist_ok=True)
        if os.path.isfile(path):
            text = open(path, "r", encoding="utf-8").read().strip()
            if text:
                return _derive_key_material(text)
        secret = secrets.token_urlsafe(32)
        with open(path, "w", encoding="utf-8") as f:
            f.write(secret)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return _derive_key_material(secret)
    except OSError:
        # крайний fallback только если DATA_DIR недоступен
        return _derive_key_material("lis-admin-vault")


def _legacy_vault_keys() -> List[bytes]:
    """Старые ключи (до отвязки от ADMIN/MASTER) — только для чтения v1."""
    keys: List[bytes] = []
    seen = set()
    for secret in (
        os.environ.get("LIS_VAULT_KEY"),
        os.environ.get("MASTER_PASSWORD"),
        os.environ.get("ADMIN_PASSWORD"),
        "lis-admin-vault",
        "admin",
    ):
        if not secret:
            continue
        k = _derive_key_material(str(secret).strip())
        if k in seen:
            continue
        seen.add(k)
        keys.append(k)
    # текущий ключ тоже
    cur = _vault_key()
    if cur not in seen:
        keys.insert(0, cur)
    else:
        keys = [cur] + [k for k in keys if k != cur]
    return keys


def _keystream(key: bytes, length: int, *, nonce: bytes = b"") -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        msg = nonce + counter.to_bytes(8, "big")
        out.extend(hmac.new(key, msg, hashlib.sha256).digest())
        counter += 1
    return bytes(out[:length])


def _seal_password(password: str) -> str:
    """Обратимое хранение пароля только для просмотра администратором (v2 + nonce)."""
    data = (password or "").encode("utf-8")
    nonce = secrets.token_bytes(16)
    key = _vault_key()
    sealed = bytes(a ^ b for a, b in zip(data, _keystream(key, len(data), nonce=nonce)))
    blob = base64.urlsafe_b64encode(nonce + sealed).decode("ascii")
    return "v2:" + blob


def _unseal_with_key(raw: bytes, key: bytes, *, nonce: bytes = b"") -> str:
    plain = bytes(a ^ b for a, b in zip(raw, _keystream(key, len(raw), nonce=nonce)))
    return plain.decode("utf-8")


def _unseal_password(sealed: Optional[str]) -> str:
    if not sealed:
        return ""
    s = str(sealed)
    if s.startswith("v2:"):
        try:
            blob = base64.urlsafe_b64decode(s[3:].encode("ascii"))
        except Exception:
            return ""
        if len(blob) < 17:
            return ""
        nonce, raw = blob[:16], blob[16:]
        for key in _legacy_vault_keys():
            try:
                return _unseal_with_key(raw, key, nonce=nonce)
            except Exception:
                continue
        return ""
    if s.startswith("v1:"):
        try:
            raw = base64.urlsafe_b64decode(s[3:].encode("ascii"))
        except Exception:
            return ""
        for key in _legacy_vault_keys():
            try:
                # v1: keystream без nonce (как раньше)
                out = bytearray()
                counter = 0
                while len(out) < len(raw):
                    out.extend(
                        hmac.new(key, counter.to_bytes(8, "big"), hashlib.sha256).digest()
                    )
                    counter += 1
                return bytes(a ^ b for a, b in zip(raw, out)).decode("utf-8")
            except Exception:
                continue
        return ""
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
        CREATE TABLE IF NOT EXISTS user_module_access (
            user_id TEXT NOT NULL,
            module_id TEXT NOT NULL,
            level TEXT NOT NULL,
            PRIMARY KEY (user_id, module_id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_module_access_user ON user_module_access(user_id);
        CREATE TABLE IF NOT EXISTS job_titles (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived_at TEXT
        );
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
        ucols.add("is_tester")
    if "use_module_acl" not in ucols:
        conn.execute(
            "ALTER TABLE users ADD COLUMN use_module_acl INTEGER NOT NULL DEFAULT 0"
        )
        ucols.add("use_module_acl")
    if "avatar_ext" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN avatar_ext TEXT NOT NULL DEFAULT ''")
        ucols.add("avatar_ext")
    if "avatar_rev" not in ucols:
        conn.execute("ALTER TABLE users ADD COLUMN avatar_rev TEXT NOT NULL DEFAULT ''")
        ucols.add("avatar_rev")
    # Бывший hardcode «си_тестер» / «СИ_Тестер» (кириллица: SQLite lower() ненадёжен).
    def _is_si_tester_name(value: str) -> bool:
        s = "".join(ch for ch in (value or "").strip().casefold() if ch.isalnum())
        return s == "ситестер"

    for row in conn.execute(
        "SELECT id, login, display_name, is_tester FROM users"
    ):
        if row["is_tester"]:
            continue
        if _is_si_tester_name(row["login"] or "") or _is_si_tester_name(
            row["display_name"] or ""
        ):
            conn.execute(
                "UPDATE users SET is_tester=1 WHERE id=?",
                (row["id"],),
            )

    # Мягкий архив: updated_at / archived_at (данные не удаляем).
    for table in ("departments", "staff", "users"):
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if "updated_at" not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN updated_at TEXT")
            conn.execute(
                f"UPDATE {table} SET updated_at=created_at WHERE updated_at IS NULL"
            )
        if "archived_at" not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN archived_at TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_staff_archived ON staff(archived_at)"
    )

    # Справочник должностей: базовые три (+ коды, которые уже есть у сотрудников).
    now = _now()
    for code, name, _short, order in CORE_JOB_TITLES:
        conn.execute(
            """
            INSERT OR IGNORE INTO job_titles(id, code, name, sort_order, created_at, updated_at)
            VALUES(?,?,?,?,?,?)
            """,
            (uuid.uuid4().hex, code, name, order, now, now),
        )
    known = {r["code"] for r in conn.execute("SELECT code FROM job_titles").fetchall()}
    extra_order = 100
    for r in conn.execute("SELECT DISTINCT role FROM staff").fetchall():
        code = (r["role"] or "").strip()
        if code and code not in known:
            conn.execute(
                """
                INSERT INTO job_titles(id, code, name, sort_order, created_at, updated_at)
                VALUES(?,?,?,?,?,?)
                """,
                (uuid.uuid4().hex, code, ROLE_LABELS.get(code) or code, extra_order, now, now),
            )
            known.add(code)
            extra_order += 1


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


def get_user_module_grants(user_id: str) -> Dict[str, str]:
    """Сырые персональные уровни из ACL (без legacy)."""
    if not user_id:
        return {}
    out: Dict[str, str] = {}
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT module_id, level FROM user_module_access WHERE user_id=?",
            (user_id,),
        ).fetchall()
    for row in rows:
        mid = (row["module_id"] or "").strip()
        level = features._normalize_level(row["level"])
        if mid and level in features.LEVELS:
            out[mid] = level
    return out


def set_user_module_grants(user_id: str, grants: Dict[str, Any], *, enable_acl: bool = True) -> Dict[str, str]:
    """Полная замена матрицы доступа. grants: {module_id: 'read'|'write'|falsy}."""
    if not user_id:
        raise ValueError("Пользователь не найден")
    cur = get_user(user_id)
    if not cur:
        raise ValueError("Пользователь не найден")
    allowed = {m["id"] for m in features.grantable_modules()}
    cleaned: Dict[str, str] = {}
    for mid, raw in (grants or {}).items():
        mid = str(mid or "").strip()
        if mid not in allowed:
            continue
        level = features._normalize_level(raw)
        if level in features.LEVELS:
            cleaned[mid] = level
    with db.connect() as conn:
        conn.execute("DELETE FROM user_module_access WHERE user_id=?", (user_id,))
        for mid, level in cleaned.items():
            conn.execute(
                """
                INSERT INTO user_module_access(user_id, module_id, level)
                VALUES(?,?,?)
                """,
                (user_id, mid, level),
            )
        if enable_acl:
            conn.execute(
                "UPDATE users SET use_module_acl=1 WHERE id=?",
                (user_id,),
            )
    return cleaned


def public_user(
    row, *, include_password: bool = False, names: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    if not row:
        return {}
    d = dict(row) if not isinstance(row, dict) else dict(row)
    vault = d.pop("password_vault", None)
    d.pop("password_hash", None)
    d["role_label"] = role_label(d.get("role") or "", names)
    d["must_change_password"] = bool(d.get("must_change_password"))
    d["is_tester"] = bool(d.get("is_tester") or d.get("can_flight_sheet"))
    # Совместимость со старым клиентом / localStorage.
    d["can_flight_sheet"] = d["is_tester"]
    d["use_module_acl"] = bool(d.get("use_module_acl"))
    grants = get_user_module_grants(d.get("id") or "")
    d["module_grants"] = grants
    d["modules"] = features.visible_modules(d, grants)
    d["module_levels"] = features.module_levels(d, grants)
    if include_password:
        plain = _unseal_password(vault) or ""
        d["password"] = plain
        # ленивая миграция v1 → v2 под актуальный ключ vault
        if plain and isinstance(vault, str) and vault.startswith("v1:") and d.get("id"):
            try:
                with db.connect() as conn:
                    conn.execute(
                        "UPDATE users SET password_vault=? WHERE id=?",
                        (_seal_password(plain), d["id"]),
                    )
            except Exception:
                pass
    else:
        d.pop("password", None)
    d["active"] = bool(d.get("active", 1))
    ext = (d.get("avatar_ext") or "").strip().lower()
    rev = (d.get("avatar_rev") or "").strip()
    uid = (d.get("id") or "").strip()
    if ext and uid and ext in ("jpg", "jpeg", "png", "webp"):
        if ext == "jpeg":
            ext = "jpg"
        d["has_avatar"] = True
        d["avatar_url"] = f"/api/admin/users/{uid}/avatar?v={rev or '1'}"
    else:
        d["has_avatar"] = False
        d["avatar_url"] = None
    # Профиль для шапки: ФИО · позывной · должность · отдел
    resolved = (d.pop("resolved_callsign", None) if "resolved_callsign" in d else None)
    if resolved is None:
        resolved = d.get("callsign")
    d["callsign"] = (resolved or "").strip()
    d["department_name"] = (d.get("department_name") or "").strip()
    staff_fio = (d.get("staff_fio") or "").strip()
    d["fio"] = (
        (d.get("display_name") or "").strip()
        or staff_fio
        or (d.get("login") or "").strip()
    )
    return d


_USER_PROFILE_SQL = """
SELECT u.*,
  d.name AS department_name,
  s.fio AS staff_fio,
  COALESCE(
    NULLIF(TRIM(s.callsign), ''),
    NULLIF(TRIM(u.callsign), ''),
    ''
  ) AS resolved_callsign
FROM users u
LEFT JOIN departments d ON d.id=u.department_id
LEFT JOIN staff s ON s.id=u.staff_id
"""


def get_user(user_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            _USER_PROFILE_SQL + " WHERE u.id=?", (user_id,)
        ).fetchone()
        names = _job_title_names(conn) if row else None
    return public_user(row, names=names) if row else None


def get_user_by_login(login: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE lower(login)=lower(?)",
            ((login or "").strip(),),
        ).fetchone()
    return dict(row) if row else None


_AVATAR_MAX_BYTES = 2 * 1024 * 1024
_AVATAR_TYPES = {
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


def _detect_avatar_ext(raw: bytes) -> str:
    if len(raw) >= 3 and raw[:3] == b"\xff\xd8\xff":
        return "jpg"
    if len(raw) >= 8 and raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if (
        len(raw) >= 12
        and raw[:4] == b"RIFF"
        and raw[8:12] == b"WEBP"
    ):
        return "webp"
    raise ValueError("Нужен файл JPEG, PNG или WebP")


def avatar_file_path(user_id: str, ext: str) -> str:
    ext = (ext or "").strip().lower()
    if ext == "jpeg":
        ext = "jpg"
    if ext not in _AVATAR_TYPES:
        raise ValueError("Недопустимый тип аватара")
    safe = re.sub(r"[^a-zA-Z0-9]", "", user_id or "")
    if not safe or safe != user_id:
        raise ValueError("Некорректный id пользователя")
    db.ensure_dirs()
    return os.path.join(db.AVATARS_DIR, f"{safe}.{ext}")


def get_avatar_path(user_id: str) -> Optional[tuple]:
    """Возвращает (path, media_type) или None."""
    with db.connect() as conn:
        row = conn.execute(
            "SELECT avatar_ext FROM users WHERE id=?", (user_id,)
        ).fetchone()
    if not row:
        return None
    ext = (row["avatar_ext"] or "").strip().lower()
    if ext == "jpeg":
        ext = "jpg"
    if ext not in _AVATAR_TYPES:
        return None
    path = avatar_file_path(user_id, ext)
    if not os.path.isfile(path):
        return None
    return path, _AVATAR_TYPES[ext]


def _clear_avatar_files(user_id: str):
    for ext in _AVATAR_TYPES:
        path = os.path.join(db.AVATARS_DIR, f"{user_id}.{ext}")
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass


def set_user_avatar(user_id: str, raw: bytes) -> Dict[str, Any]:
    if not raw:
        raise ValueError("Пустой файл")
    if len(raw) > _AVATAR_MAX_BYTES:
        raise ValueError("Файл больше 2 МБ")
    ext = _detect_avatar_ext(raw)
    with db.connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise ValueError("Учётная запись не найдена")
        db.ensure_dirs()
        _clear_avatar_files(user_id)
        path = avatar_file_path(user_id, ext)
        with open(path, "wb") as f:
            f.write(raw)
        rev = _now()
        conn.execute(
            "UPDATE users SET avatar_ext=?, avatar_rev=?, updated_at=? WHERE id=?",
            (ext, rev, rev, user_id),
        )
    return get_user(user_id) or {}


def clear_user_avatar(user_id: str) -> Dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise ValueError("Учётная запись не найдена")
        _clear_avatar_files(user_id)
        now = _now()
        conn.execute(
            "UPDATE users SET avatar_ext='', avatar_rev='', updated_at=? WHERE id=?",
            (now, user_id),
        )
    return get_user(user_id) or {}


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
            SELECT u.*,
              d.name AS department_name,
              s.fio AS staff_fio,
              COALESCE(
                NULLIF(TRIM(s.callsign), ''),
                NULLIF(TRIM(u.callsign), ''),
                ''
              ) AS resolved_callsign
            FROM auth_tokens t
            JOIN users u ON u.id=t.user_id
            LEFT JOIN departments d ON d.id=u.department_id
            LEFT JOIN staff s ON s.id=u.staff_id
            WHERE t.token=? AND u.active=1
            """,
            (token,),
        ).fetchone()
        names = _job_title_names(conn) if row else None
    return public_user(row, names=names) if row else None


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
    # заполнить vault / обновить хеш (старый формат → pbkdf2_sha256$@210k)
    need_vault = not (row.get("password_vault") or "").strip()
    need_rehash = _password_needs_rehash(row.get("password_hash") or "")
    need_vault_upgrade = str(row.get("password_vault") or "").startswith("v1:")
    if need_vault or need_rehash or need_vault_upgrade:
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
    role_ch = _first_latin_letter(role_label(role or "")) or "x"
    return "".join(initials[:3]) + role_ch


def credentials_from_staff(fio: str, role: str) -> Dict[str, str]:
    return {
        "login": login_from_fio(fio),
        "password": password_from_staff(fio, role),
    }


# ---------- sorting helpers ----------
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


def _norm_title_key(s: str) -> str:
    s = (s or "").strip().casefold().replace("ё", "е")
    s = re.sub(r"[.\u00a0]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ---------- job titles (справочник должностей) ----------
_TITLE_ALIASES_CORE = {
    "senior": ("си", "старший", "старший инструктор", "senior"),
    "instructor": ("и", "инструктор", "instructor"),
    "assistant": ("аи", "ассистент", "ассистент инструктора", "assistant"),
}


def _title_public(row, staff_count: Optional[int] = None) -> Dict[str, Any]:
    d = dict(row)
    d["short"] = job_title_short(d.get("code") or "", d.get("name") or "")
    d["archived"] = bool(d.get("archived_at"))
    d["core"] = (d.get("code") or "") in _CORE_SHORT
    if staff_count is not None:
        d["staff_count"] = staff_count
    return d


def list_job_titles(include_archived: bool = False) -> List[Dict[str, Any]]:
    with db.connect() as conn:
        sql = "SELECT * FROM job_titles"
        if not include_archived:
            sql += " WHERE archived_at IS NULL"
        sql += " ORDER BY sort_order, name COLLATE NOCASE"
        rows = conn.execute(sql).fetchall()
        counts = {
            r["role"]: r["n"]
            for r in conn.execute(
                "SELECT role, COUNT(*) AS n FROM staff WHERE archived_at IS NULL GROUP BY role"
            ).fetchall()
        }
    return [_title_public(r, counts.get(r["code"], 0)) for r in rows]


def get_job_title(title_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM job_titles WHERE id=?", (title_id,)).fetchone()
    return _title_public(row) if row else None


def get_job_title_by_code(code: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM job_titles WHERE code=?", (code or "",)).fetchone()
    return _title_public(row) if row else None


def _clean_title_name(name: str) -> str:
    name = re.sub(r"\s+", " ", (name or "").strip())
    if not name:
        raise ValueError("Укажите название должности")
    if len(name) > 80:
        raise ValueError("Название должности: не длиннее 80 символов")
    return name


def _slug_code(name: str, conn) -> str:
    """Код должности из названия: латиница/цифры/_ ; уникален в job_titles."""
    out = []
    for ch in (name or "").casefold():
        if "a" <= ch <= "z" or ch.isdigit():
            out.append(ch)
        elif ch in _CYR_TO_LAT:
            out.append(_CYR_TO_LAT[ch])
        else:
            out.append("_")
    base = re.sub(r"_+", "_", "".join(out)).strip("_")[:40] or "title"
    if base in ROLES:  # admin и т.п. — зарезервировано под логин-роли
        base = "title_" + base
    taken = {r["code"] for r in conn.execute("SELECT code FROM job_titles").fetchall()}
    code, n = base, 2
    while code in taken:
        code = f"{base}_{n}"
        n += 1
    return code


def create_job_title(name: str) -> Dict[str, Any]:
    name = _clean_title_name(name)
    key = name.casefold()
    now = _now()
    with db.connect() as conn:
        for r in conn.execute("SELECT name, archived_at FROM job_titles").fetchall():
            if (r["name"] or "").strip().casefold() == key:
                if r["archived_at"]:
                    raise ValueError(f"Должность «{name}» есть в архиве — восстановите её")
                raise ValueError(f"Должность «{name}» уже существует")
        code = _slug_code(name, conn)
        order = conn.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM job_titles").fetchone()[0]
        tid = uuid.uuid4().hex
        conn.execute(
            """
            INSERT INTO job_titles(id, code, name, sort_order, created_at, updated_at)
            VALUES(?,?,?,?,?,?)
            """,
            (tid, code, name, int(order), now, now),
        )
    return get_job_title(tid) or {}


def update_job_title(
    title_id: str, *, name: Optional[str] = None, sort_order: Optional[int] = None
) -> Dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM job_titles WHERE id=?", (title_id,)).fetchone()
        if not row:
            raise ValueError("Должность не найдена")
        new_name = row["name"]
        if name is not None:
            new_name = _clean_title_name(name)
            key = new_name.casefold()
            for r in conn.execute(
                "SELECT name FROM job_titles WHERE id<>?", (title_id,)
            ).fetchall():
                if (r["name"] or "").strip().casefold() == key:
                    raise ValueError(f"Должность «{new_name}» уже существует")
        new_order = row["sort_order"] if sort_order is None else int(sort_order)
        conn.execute(
            "UPDATE job_titles SET name=?, sort_order=?, updated_at=? WHERE id=?",
            (new_name, new_order, _now(), title_id),
        )
    return get_job_title(title_id) or {}


def archive_job_title(title_id: str) -> Dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM job_titles WHERE id=?", (title_id,)).fetchone()
        if not row:
            raise ValueError("Должность не найдена")
        if row["code"] in _CORE_SHORT:
            raise ValueError("Базовую должность (СИ / И / АИ) архивировать нельзя — только переименовать")
        n = conn.execute(
            "SELECT COUNT(*) FROM staff WHERE role=? AND archived_at IS NULL", (row["code"],)
        ).fetchone()[0]
        if n:
            raise ValueError(
                f"Нельзя архивировать: должность назначена {n} сотрудникам. Сначала смените им должность."
            )
        if not row["archived_at"]:
            now = _now()
            conn.execute(
                "UPDATE job_titles SET archived_at=?, updated_at=? WHERE id=?",
                (now, now, title_id),
            )
    return get_job_title(title_id) or {}


def restore_job_title(title_id: str) -> Dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM job_titles WHERE id=?", (title_id,)).fetchone()
        if not row:
            raise ValueError("Должность не найдена")
        key = (row["name"] or "").strip().casefold()
        for r in conn.execute(
            "SELECT name FROM job_titles WHERE id<>? AND archived_at IS NULL", (title_id,)
        ).fetchall():
            if (r["name"] or "").strip().casefold() == key:
                raise ValueError("Должность с таким названием уже есть среди активных")
        conn.execute(
            "UPDATE job_titles SET archived_at=NULL, updated_at=? WHERE id=?",
            (_now(), title_id),
        )
    return get_job_title(title_id) or {}


def resolve_job_title(raw: str, titles: Optional[List[Dict[str, Any]]] = None) -> Optional[str]:
    """Код активной должности по тексту: название, код, краткое (СИ/И/АИ) или алиас."""
    key = _norm_title_key(raw)
    if not key:
        return None
    if titles is None:
        titles = list_job_titles()
    for t in titles:
        if key in (_norm_title_key(t.get("code") or ""), _norm_title_key(t.get("name") or "")):
            return t["code"]
    for t in titles:
        if key == _norm_title_key(t.get("short") or ""):
            return t["code"]
        if key in _TITLE_ALIASES_CORE.get(t.get("code") or "", ()):
            return t["code"]
    return None


def _active_title_codes(conn) -> set:
    return {
        r["code"]
        for r in conn.execute("SELECT code FROM job_titles WHERE archived_at IS NULL").fetchall()
    }


def _title_orders(conn) -> Dict[str, int]:
    return {r["code"]: r["sort_order"] for r in conn.execute("SELECT code, sort_order FROM job_titles")}


# ---------- departments / staff ----------
def list_departments(include_archived: bool = False) -> List[Dict[str, Any]]:
    with db.connect() as conn:
        sql = "SELECT * FROM departments"
        if not include_archived:
            sql += " WHERE archived_at IS NULL"
        rows = conn.execute(sql).fetchall()
    out = [dict(r) for r in rows]
    out.sort(key=lambda d: _natural_name_key(d.get("name") or ""))
    return out


def get_department(department_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM departments WHERE id=?", (department_id,)).fetchone()
    return dict(row) if row else None


def create_department(name: str) -> Dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("Укажите название отдела")
    now = _now()
    with db.connect() as conn:
        exists = conn.execute(
            """
            SELECT 1 FROM departments
            WHERE lower(trim(name))=lower(?) AND archived_at IS NULL LIMIT 1
            """,
            (name,),
        ).fetchone()
        if exists:
            raise ValueError(f"Отдел {name} уже существует")
        did = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO departments(id, name, created_at, updated_at) VALUES(?,?,?,?)",
            (did, name, now, now),
        )
    return get_department(did) or {"id": did, "name": name}


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
            WHERE lower(trim(name))=lower(?) AND id<>? AND archived_at IS NULL
            LIMIT 1
            """,
            (name, department_id),
        ).fetchone()
        if exists:
            raise ValueError(f"Отдел {name} уже существует")
        conn.execute(
            "UPDATE departments SET name=?, updated_at=? WHERE id=?",
            (name, _now(), department_id),
        )
    return get_department(department_id) or {"id": department_id, "name": name}


def archive_department(department_id: str) -> Dict[str, Any]:
    """Мягкий архив отдела. Данные не удаляются; в отделе не должно быть активных ЛС/учёток."""
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM departments WHERE id=?", (department_id,)
        ).fetchone()
        if not row:
            raise ValueError("Отдел не найден")
        if row["archived_at"]:
            return dict(row)
        n_staff = conn.execute(
            "SELECT COUNT(*) FROM staff WHERE department_id=? AND archived_at IS NULL",
            (department_id,),
        ).fetchone()[0]
        if n_staff:
            raise ValueError(
                f"Нельзя архивировать отдел: в нём {n_staff} сотрудников. "
                "Сначала переведите их в другой отдел или архивируйте."
            )
        n_users = conn.execute(
            "SELECT COUNT(*) FROM users WHERE department_id=? AND archived_at IS NULL",
            (department_id,),
        ).fetchone()[0]
        if n_users:
            raise ValueError("Нельзя архивировать отдел: есть учётные записи")
        now = _now()
        conn.execute(
            "UPDATE departments SET archived_at=?, updated_at=? WHERE id=?",
            (now, now, department_id),
        )
    return get_department(department_id) or {}


# совместимость: прежнее имя
delete_department = archive_department


def restore_department(department_id: str) -> Dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM departments WHERE id=?", (department_id,)
        ).fetchone()
        if not row:
            raise ValueError("Отдел не найден")
        exists = conn.execute(
            """
            SELECT 1 FROM departments
            WHERE lower(trim(name))=lower(?) AND id<>? AND archived_at IS NULL LIMIT 1
            """,
            (row["name"], department_id),
        ).fetchone()
        if exists:
            raise ValueError(f"Отдел {row['name']} уже существует среди активных")
        conn.execute(
            "UPDATE departments SET archived_at=NULL, updated_at=? WHERE id=?",
            (_now(), department_id),
        )
    return get_department(department_id) or {}


def _attach_staff_avatar(d: Dict[str, Any], conn=None) -> Dict[str, Any]:
    """Подтянуть аватар связанной учётки в карточку сотрудника."""
    sid = (d.get("id") or "").strip()
    if not sid:
        d["account_user_id"] = None
        d["has_avatar"] = False
        d["avatar_url"] = None
        return d

    def _pick(c):
        return c.execute(
            """
            SELECT id, avatar_ext, avatar_rev, archived_at
            FROM users
            WHERE staff_id=?
            ORDER BY CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END, created_at DESC
            LIMIT 1
            """,
            (sid,),
        ).fetchone()

    if conn is not None:
        row = _pick(conn)
    else:
        with db.connect() as c:
            row = _pick(c)
    if not row:
        d["account_user_id"] = None
        d["has_avatar"] = False
        d["avatar_url"] = None
        return d
    uid = (row["id"] or "").strip()
    ext = (row["avatar_ext"] or "").strip().lower()
    if ext == "jpeg":
        ext = "jpg"
    rev = (row["avatar_rev"] or "").strip()
    d["account_user_id"] = uid or None
    if uid and ext in ("jpg", "png", "webp"):
        d["has_avatar"] = True
        d["avatar_url"] = f"/api/admin/users/{uid}/avatar?v={rev or '1'}"
    else:
        d["has_avatar"] = False
        d["avatar_url"] = None
    return d


def list_staff(
    department_id: Optional[str] = None, include_archived: bool = False
) -> List[Dict[str, Any]]:
    """Личный состав. Архивные скрыты, пока include_archived не включён."""
    sql = """
        SELECT s.*, d.name AS department_name
        FROM staff s JOIN departments d ON d.id=s.department_id
    """
    where = []
    params: List[Any] = []
    if department_id:
        where.append("s.department_id=?")
        params.append(department_id)
    if not include_archived:
        where.append("s.archived_at IS NULL")
    if where:
        sql += " WHERE " + " AND ".join(where)
    with db.connect() as conn:
        rows = conn.execute(sql, params).fetchall()
        names = _job_title_names(conn)
        orders = _title_orders(conn)
        out = []
        for r in rows:
            d = dict(r)
            d["role_label"] = role_label(d["role"], names)
            d["role_short"] = job_title_short(d["role"], d["role_label"])
            _attach_staff_avatar(d, conn)
            out.append(d)
    out.sort(
        key=lambda d: (
            [] if department_id else _natural_name_key(d.get("department_name") or ""),
            orders.get(d.get("role"), 999),
            (d.get("fio") or "").casefold(),
        )
    )
    return out


def _fio_taken(conn, fio_key: str, exclude_id: Optional[str] = None) -> bool:
    """ФИО уже занято среди активных (не архивных) сотрудников."""
    for row in conn.execute(
        "SELECT id, fio FROM staff WHERE archived_at IS NULL"
    ).fetchall():
        if exclude_id and row["id"] == exclude_id:
            continue
        if db._norm_fio(row["fio"] or "").casefold() == fio_key:
            return True
    return False


def add_staff(
    department_id: str, role: str, fio: str, callsign: str = ""
) -> Dict[str, Any]:
    role = (role or "").strip()
    fio = db._norm_fio(fio or "")
    if not fio:
        raise ValueError("Укажите ФИО")
    fio_key = fio.casefold()
    sid = uuid.uuid4().hex
    now = _now()
    with db.connect() as conn:
        if role not in _active_title_codes(conn):
            raise ValueError("Должность не найдена в справочнике")
        dep = conn.execute(
            "SELECT id FROM departments WHERE id=? AND archived_at IS NULL", (department_id,)
        ).fetchone()
        if not dep:
            raise ValueError("Отдел не найден")
        if _fio_taken(conn, fio_key):
            raise ValueError("Сотрудник с таким ФИО уже есть в таблице")
        conn.execute(
            """
            INSERT INTO staff(id, department_id, role, fio, callsign, created_at, updated_at)
            VALUES(?,?,?,?,?,?,?)
            """,
            (sid, department_id, role, fio, (callsign or "").strip(), now, now),
        )
    return get_staff(sid) or {
        "id": sid, "department_id": department_id, "role": role, "fio": fio, "callsign": callsign
    }


def update_staff(
    staff_id: str,
    *,
    department_id: str,
    role: str,
    fio: str,
    callsign: str = "",
) -> Dict[str, Any]:
    role = (role or "").strip()
    fio = db._norm_fio(fio or "")
    if not fio:
        raise ValueError("Укажите ФИО")
    fio_key = fio.casefold()
    callsign = (callsign or "").strip()
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id, role, archived_at FROM staff WHERE id=?", (staff_id,)
        ).fetchone()
        if not row:
            raise ValueError("Сотрудник не найден")
        if row["archived_at"]:
            raise ValueError("Сотрудник в архиве — сначала восстановите его")
        if role != row["role"] and role not in _active_title_codes(conn):
            raise ValueError("Должность не найдена в справочнике")
        dep = conn.execute(
            "SELECT id FROM departments WHERE id=? AND archived_at IS NULL", (department_id,)
        ).fetchone()
        if not dep:
            raise ValueError("Отдел не найден")
        if _fio_taken(conn, fio_key, exclude_id=staff_id):
            raise ValueError("Сотрудник с таким ФИО уже есть в таблице")
        conn.execute(
            """
            UPDATE staff
            SET department_id=?, role=?, fio=?, callsign=?, updated_at=?
            WHERE id=?
            """,
            (department_id, role, fio, callsign, _now(), staff_id),
        )
        # синхронизация отдела у привязанных учёток (не admin)
        conn.execute(
            """
            UPDATE users SET department_id=?
            WHERE staff_id=? AND role<>'admin'
            """,
            (department_id, staff_id),
        )
    return get_staff(staff_id) or {}


def archive_staff(staff_id: str) -> Dict[str, Any]:
    """Мягкий архив: запись остаётся, учётка отключается (active=0 + archived_at), токены сбрасываются."""
    now = _now()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM staff WHERE id=?", (staff_id,)).fetchone()
        if not row:
            raise ValueError("Сотрудник не найден")
        if row["archived_at"]:
            user_ids: List[str] = []
        else:
            conn.execute(
                "UPDATE staff SET archived_at=?, updated_at=? WHERE id=?",
                (now, now, staff_id),
            )
            user_ids = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM users WHERE staff_id=? AND archived_at IS NULL",
                    (staff_id,),
                ).fetchall()
            ]
            conn.execute(
                """
                UPDATE users SET active=0, archived_at=?, updated_at=?
                WHERE staff_id=? AND archived_at IS NULL
                """,
                (now, now, staff_id),
            )
    for uid in user_ids:
        revoke_user_tokens(uid)
    return get_staff(staff_id) or {}


# совместимость: прежнее имя (физически строку больше не удаляем)
delete_staff = archive_staff


def restore_staff(staff_id: str, *, restore_account: bool = False) -> Dict[str, Any]:
    """Вернуть из архива. Учётку, архивированную вместе с сотрудником, — только по restore_account."""
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM staff WHERE id=?", (staff_id,)).fetchone()
        if not row:
            raise ValueError("Сотрудник не найден")
        if not row["archived_at"]:
            return get_staff(staff_id) or {}
        dep = conn.execute(
            "SELECT id FROM departments WHERE id=? AND archived_at IS NULL",
            (row["department_id"],),
        ).fetchone()
        if not dep:
            raise ValueError("Отдел сотрудника в архиве — сначала восстановите отдел")
        fio_key = db._norm_fio(row["fio"] or "").casefold()
        if _fio_taken(conn, fio_key, exclude_id=staff_id):
            raise ValueError("Сотрудник с таким ФИО уже есть среди активных")
        now = _now()
        conn.execute(
            "UPDATE staff SET archived_at=NULL, updated_at=? WHERE id=?",
            (now, staff_id),
        )
        if restore_account:
            conn.execute(
                """
                UPDATE users SET active=1, archived_at=NULL, updated_at=?
                WHERE staff_id=? AND archived_at=?
                """,
                (now, staff_id, row["archived_at"]),
            )
    return get_staff(staff_id) or {}


def get_staff(staff_id: str) -> Optional[Dict[str, Any]]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM staff WHERE id=?", (staff_id,)).fetchone()
        names = _job_title_names(conn) if row else {}
        if not row:
            return None
        d = dict(row)
        d["role_label"] = role_label(d.get("role") or "", names)
        d["role_short"] = job_title_short(d.get("role") or "", d["role_label"])
        _attach_staff_avatar(d, conn)
        return d


# ---------- users CRUD ----------
def list_users(
    *, include_passwords: bool = False, include_archived: bool = False
) -> List[Dict[str, Any]]:
    """Пароли (include_passwords) — только для ответа API администратора.

    Архивные учётки (archived_at) скрыты, пока include_archived не включён.
    """
    with db.connect() as conn:
        names = _job_title_names(conn)
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
            WHERE (? OR u.archived_at IS NULL)
            ORDER BY
              CASE u.role WHEN 'admin' THEN 0 WHEN 'senior' THEN 1
                WHEN 'instructor' THEN 2 ELSE 3 END,
              u.login COLLATE NOCASE
            """,
            (1 if include_archived else 0,),
        ).fetchall()
    out = []
    for r in rows:
        d = public_user(r, include_password=include_passwords, names=names)
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
        if st.get("archived_at"):
            raise ValueError("Сотрудник в архиве — сначала восстановите его")
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
        role_name = st.get("role_label") or role_label(role)
        dep_name = (st.get("department_name") or "").strip() or "—"
        creds = credentials_from_staff(fio, role)
        login = creds["login"]
        password = creds["password"]
        login_key = login.casefold() if login else ""
        base = {
            "fio": fio,
            "login": login,
            "password": password,
            "role": role_name,
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
                    "role": role_name,
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
                    "UPDATE staff SET callsign=?, updated_at=? WHERE id=?",
                    (call_n, _now(), staff_id),
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
    for u in list_users(include_passwords=True, include_archived=True):
        if u.get("id") == user_id:
            return u
    return get_user(user_id)


def set_user_active(user_id: str, active: bool):
    """Включить/отключить вход. Включение снимает архив; отключение — нет (это не архив)."""
    now = _now()
    with db.connect() as conn:
        if active:
            st = conn.execute(
                """
                SELECT s.archived_at FROM users u JOIN staff s ON s.id=u.staff_id
                WHERE u.id=?
                """,
                (user_id,),
            ).fetchone()
            if st and st["archived_at"]:
                raise ValueError("Сотрудник в архиве — сначала восстановите его в штатке")
            conn.execute(
                "UPDATE users SET active=1, archived_at=NULL, updated_at=? WHERE id=?",
                (now, user_id),
            )
        else:
            conn.execute(
                "UPDATE users SET active=0, updated_at=? WHERE id=?",
                (now, user_id),
            )
    if not active:
        revoke_user_tokens(user_id)


def archive_user(user_id: str, actor_id: str):
    """Мягкий архив учётки: active=0 + archived_at. Строка и история сохраняются."""
    if user_id == actor_id:
        raise ValueError("Нельзя архивировать себя")
    u = get_user(user_id)
    if not u:
        raise ValueError("Пользователь не найден")
    if u["role"] == "admin" and u.get("active"):
        with db.connect() as conn:
            n = conn.execute(
                "SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND archived_at IS NULL"
            ).fetchone()[0]
        if n <= 1:
            raise ValueError("Нельзя архивировать последнего администратора")
    now = _now()
    with db.connect() as conn:
        conn.execute(
            """
            UPDATE users SET active=0, archived_at=COALESCE(archived_at, ?), updated_at=?
            WHERE id=?
            """,
            (now, now, user_id),
        )
    revoke_user_tokens(user_id)


# совместимость: прежнее имя (физически строку больше не удаляем)
delete_user = archive_user


def restore_user(user_id: str):
    """Вернуть учётку из архива и включить вход."""
    if not get_user(user_id):
        raise ValueError("Пользователь не найден")
    set_user_active(user_id, True)


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


def can_access_exam(user: Dict[str, Any], exam: Dict[str, Any]) -> bool:
    return can_access_test(user, exam)


def filter_exams_for_user(user: Dict[str, Any], exams: List[Dict[str, Any]]):
    return [e for e in exams if can_access_exam(user, e)]


def visible_exam_ids(user: Dict[str, Any]) -> Optional[List[str]]:
    """None = все экзамены (admin)."""
    if user.get("role") == "admin":
        return None
    from . import exams as exams_mod

    items = exams_mod.list_exams()
    return [e["id"] for e in items if can_access_exam(user, e)]


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
