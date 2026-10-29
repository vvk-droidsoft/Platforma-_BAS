# -*- coding: utf-8 -*-
"""Автоверсия статики: ?v= по MD5 содержимого файла.

При отдаче HTML все ссылки /static/... .(js|css|…) получают актуальный хэш.
Ручной пересчёт ?v= в HTML больше не нужен.
"""
from __future__ import annotations

import hashlib
import os
import re
from typing import Dict, Optional, Tuple

_ASSET_EXT = (
    "js|css|mjs|map|tpl|xlsx|xlsm|xls|otf|ttf|woff2?|svg|png|jpe?g|gif|webp|ico"
)
# src="/static/foo.js?v=old" / href='/static/foo.css'
_URL_RE = re.compile(
    r'(?P<pre>(?:src|href)\s*=\s*["\'])'
    r"(?P<path>/static/[^\"'?#]+?\.(?:" + _ASSET_EXT + r"))"
    r"(?:\?[^\"']*)?"
    r'(?P<post>["\'])',
    re.IGNORECASE,
)
# строковые литералы в inline/JS: "/static/foo.xlsx?v=…"
_STR_RE = re.compile(
    r'(?P<pre>["\'])'
    r"(?P<path>/static/[^\"'?#]+?\.(?:" + _ASSET_EXT + r"))"
    r"(?:\?[^\"']*)?"
    r'(?P<post>["\'])',
    re.IGNORECASE,
)

# (abspath, mtime_ns, size) -> hex10
_HASH_CACHE: Dict[Tuple[str, int, int], str] = {}


def file_hash(path: str, *, length: int = 10) -> Optional[str]:
    """MD5 файла (первые length hex-символов) или None, если файла нет."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (os.path.abspath(path), int(getattr(st, "st_mtime_ns", int(st.st_mtime * 1e9))), st.st_size)
    cached = _HASH_CACHE.get(key)
    if cached is not None:
        return cached[:length]
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 256), b""):
            h.update(chunk)
    digest = h.hexdigest()
    _HASH_CACHE[key] = digest
    return digest[:length]


def version_for(static_dir: str, url_path: str) -> Optional[str]:
    """url_path вида /static/admin/admin-app.js → хэш файла."""
    if not url_path.startswith("/static/"):
        return None
    rel = url_path[len("/static/") :].replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        return None
    return file_hash(os.path.join(static_dir, *rel.split("/")))


def _rewrite(match: re.Match, static_dir: str) -> str:
    path = match.group("path")
    ver = version_for(static_dir, path)
    if not ver:
        return match.group(0)
    return f"{match.group('pre')}{path}?v={ver}{match.group('post')}"


def bust_static_urls(text: str, static_dir: str, *, strings: bool = False) -> str:
    """Подставляет ?v=<md5> для /static/… в HTML (атрибуты src/href).

    strings=True — также в строковых литералах (для JS-файлов).
    """
    if not text or not static_dir:
        return text
    out = _URL_RE.sub(lambda m: _rewrite(m, static_dir), text)
    if strings:
        out = _STR_RE.sub(lambda m: _rewrite(m, static_dir), out)
    return out


def bridge_version(static_dir: str) -> str:
    """Хэш test-bridge.js для inject; fallback — mtime."""
    path = os.path.join(static_dir, "test-bridge.js")
    ver = file_hash(path)
    if ver:
        return ver
    try:
        return str(int(os.path.getmtime(path)))
    except OSError:
        return "0"
