#!/usr/bin/env python3
"""Sola Galaxy web server with shared SQLite feedback storage.

Run locally with:
    py server.py

Then open http://localhost:8000
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = Path(os.environ.get("DATABASE_PATH", DATA_DIR / "sola_feedback.db"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
MAX_REQUEST_BYTES = 20_000
MAX_COMMENTS_PER_CHAPTER = 200
COMMENT_COOLDOWN_SECONDS = 8

CHAPTERS = {
    "tiberius-kael-norek",
    "exam",
    "shareen-maxamillian",
    "lower-commodore",
    "middle-commodore",
    "randolph-5",
    "fleet-admiral",
    "victorious",
}

ALLOWED_ROOT_FILES = {
    "index.html",
    "book1.html",
    "characters.html",
    "tiberius.html",
    "styles.css",
    "script.js",
    "solagalaxy_favicon.ico",
}

VISITOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,100}$")
DB_LOCK = threading.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def initialize_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DB_LOCK, connect_db() as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS reactions (
                chapter_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (chapter_id, visitor_id)
            );

            CREATE INDEX IF NOT EXISTS idx_reactions_chapter
                ON reactions (chapter_id, reaction);

            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chapter_id TEXT NOT NULL,
                visitor_id TEXT NOT NULL,
                name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1))
            );

            CREATE INDEX IF NOT EXISTS idx_comments_chapter_created
                ON comments (chapter_id, created_at DESC);
            """
        )


def safe_text(value: object, maximum: int) -> str:
    if not isinstance(value, str):
        return ""
    # Remove control characters except normal whitespace.
    cleaned = "".join(ch for ch in value.strip() if ch >= " " or ch in "\n\t")
    return cleaned[:maximum]


def valid_visitor_id(visitor_id: str) -> bool:
    return bool(VISITOR_ID_PATTERN.fullmatch(visitor_id))


def get_feedback(chapter_id: str, visitor_id: str) -> dict:
    with connect_db() as db:
        counts = {"like": 0, "dislike": 0}
        for row in db.execute(
            """
            SELECT reaction, COUNT(*) AS total
            FROM reactions
            WHERE chapter_id = ?
            GROUP BY reaction
            """,
            (chapter_id,),
        ):
            counts[row["reaction"]] = row["total"]

        reaction_row = db.execute(
            "SELECT reaction FROM reactions WHERE chapter_id = ? AND visitor_id = ?",
            (chapter_id, visitor_id),
        ).fetchone()

        comment_rows = db.execute(
            """
            SELECT id, name, body, created_at
            FROM comments
            WHERE chapter_id = ? AND is_visible = 1
            ORDER BY id DESC
            LIMIT ?
            """,
            (chapter_id, MAX_COMMENTS_PER_CHAPTER),
        ).fetchall()

    return {
        "chapter": chapter_id,
        "counts": counts,
        "visitorReaction": reaction_row["reaction"] if reaction_row else "",
        "comments": [dict(row) for row in comment_rows],
    }


def update_reaction(chapter_id: str, visitor_id: str, reaction: str) -> dict:
    now = utc_now()
    with DB_LOCK, connect_db() as db:
        if reaction == "":
            db.execute(
                "DELETE FROM reactions WHERE chapter_id = ? AND visitor_id = ?",
                (chapter_id, visitor_id),
            )
        else:
            db.execute(
                """
                INSERT INTO reactions (chapter_id, visitor_id, reaction, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(chapter_id, visitor_id)
                DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at
                """,
                (chapter_id, visitor_id, reaction, now, now),
            )
        db.commit()
    return get_feedback(chapter_id, visitor_id)


def add_comment(chapter_id: str, visitor_id: str, name: str, body: str) -> dict:
    now = utc_now()
    display_name = name or "Anonymous"

    with DB_LOCK, connect_db() as db:
        latest = db.execute(
            """
            SELECT created_at
            FROM comments
            WHERE chapter_id = ? AND visitor_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (chapter_id, visitor_id),
        ).fetchone()

        if latest:
            previous = datetime.fromisoformat(latest["created_at"])
            elapsed = (datetime.now(timezone.utc) - previous).total_seconds()
            if elapsed < COMMENT_COOLDOWN_SECONDS:
                raise CommentRateLimit(COMMENT_COOLDOWN_SECONDS - int(elapsed))

        cursor = db.execute(
            """
            INSERT INTO comments (chapter_id, visitor_id, name, body, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (chapter_id, visitor_id, display_name, body, now),
        )
        db.commit()
        comment_id = cursor.lastrowid

    return {
        "id": comment_id,
        "name": display_name,
        "body": body,
        "created_at": now,
    }


class CommentRateLimit(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("Please wait before posting another comment.")
        self.retry_after = max(1, retry_after)


class SolaGalaxyHandler(BaseHTTPRequestHandler):
    server_version = "SolaGalaxy/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stdout.write(
            f"{self.address_string()} - [{self.log_date_time_string()}] {fmt % args}\n"
        )

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/chapters/") and path.endswith("/feedback"):
            self.handle_get_feedback(path, parsed.query)
            return

        self.serve_static(path, head_only=False)

    def do_HEAD(self) -> None:  # noqa: N802
        self.serve_static(urlparse(self.path).path, head_only=True)

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/chapters/") and parsed.path.endswith("/reaction"):
            self.handle_reaction(parsed.path)
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/chapters/") and parsed.path.endswith("/comments"):
            self.handle_comment(parsed.path)
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})

    def extract_chapter(self, path: str, suffix: str) -> str | None:
        prefix = "/api/chapters/"
        if not path.startswith(prefix) or not path.endswith(suffix):
            return None
        chapter = unquote(path[len(prefix) : -len(suffix)]).strip("/")
        return chapter if chapter in CHAPTERS else None

    def read_json(self) -> dict | None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            return None
        try:
            raw = self.rfile.read(content_length)
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def handle_get_feedback(self, path: str, query: str) -> None:
        chapter = self.extract_chapter(path, "/feedback")
        if not chapter:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown chapter."})
            return

        visitor_id = parse_qs(query).get("visitor_id", [""])[0]
        if not valid_visitor_id(visitor_id):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid visitor ID."})
            return

        self.send_json(HTTPStatus.OK, get_feedback(chapter, visitor_id))

    def handle_reaction(self, path: str) -> None:
        chapter = self.extract_chapter(path, "/reaction")
        if not chapter:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown chapter."})
            return

        data = self.read_json()
        if data is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid request."})
            return

        visitor_id = safe_text(data.get("visitorId"), 100)
        reaction = safe_text(data.get("reaction"), 10)
        if not valid_visitor_id(visitor_id) or reaction not in {"", "like", "dislike"}:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid reaction."})
            return

        self.send_json(HTTPStatus.OK, update_reaction(chapter, visitor_id, reaction))

    def handle_comment(self, path: str) -> None:
        chapter = self.extract_chapter(path, "/comments")
        if not chapter:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown chapter."})
            return

        data = self.read_json()
        if data is None:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid request."})
            return

        visitor_id = safe_text(data.get("visitorId"), 100)
        name = safe_text(data.get("name"), 80)
        body = safe_text(data.get("comment"), 1000)

        if not valid_visitor_id(visitor_id):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid visitor ID."})
            return
        if not body:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Comment cannot be empty."})
            return

        try:
            comment = add_comment(chapter, visitor_id, name, body)
        except CommentRateLimit as exc:
            self.send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {"error": str(exc), "retryAfter": exc.retry_after},
                extra_headers={"Retry-After": str(exc.retry_after)},
            )
            return

        self.send_json(HTTPStatus.CREATED, {"comment": comment})

    def serve_static(self, request_path: str, head_only: bool) -> None:
        path = unquote(request_path)
        if path == "/":
            relative = Path("index.html")
        else:
            relative = Path(path.lstrip("/"))

        allowed = (
            len(relative.parts) == 1 and relative.name in ALLOWED_ROOT_FILES
        ) or (
            len(relative.parts) >= 2 and relative.parts[0] == "assets"
        )

        if not allowed or ".." in relative.parts:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        file_path = (BASE_DIR / relative).resolve()
        try:
            file_path.relative_to(BASE_DIR)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        if not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type, _ = mimetypes.guess_type(file_path.name)
        content_type = content_type or "application/octet-stream"
        stat = file_path.stat()

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        if file_path.suffix in {".html", ".js", ".css"}:
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()

        if not head_only:
            with file_path.open("rb") as source:
                while chunk := source.read(64 * 1024):
                    self.wfile.write(chunk)

    def send_json(
        self,
        status: HTTPStatus,
        payload: dict,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), SolaGalaxyHandler)
    print(f"Sola Galaxy running at http://localhost:{PORT}")
    print(f"Shared feedback database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
