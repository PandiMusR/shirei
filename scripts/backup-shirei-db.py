#!/usr/bin/env python3
"""Online backup of the Shirei SQLite database.

Writes a temp file, checks it, then renames it into place. Retention keeps the
newest 14 files whose names match shirei-*.db.

Restore (run from /srv/shirei/app so the 768m compose file stays in use):
  docker compose -p shirei stop app
  cp /root/backups/shirei/shirei-YYYYMMDD-HHMMSS.db /srv/shirei/app/data/app/shirei.db
  rm -f /srv/shirei/app/data/app/shirei.db-wal /srv/shirei/app/data/app/shirei.db-shm
  docker compose -p shirei start app
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DB_PATH = Path('/srv/shirei/app/data/app/shirei.db')
BACKUP_DIR = Path('/root/backups/shirei')
LOG_PATH = BACKUP_DIR / 'backup.log'
KEEP = 14
ZONE = ZoneInfo('Asia/Jakarta')


def matching_backups(directory: Path) -> list[Path]:
    files = [path for path in directory.glob('shirei-*.db') if path.is_file()]
    files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return files


def prune_backups(directory: Path, keep: int = KEEP) -> list[Path]:
    removed: list[Path] = []
    for old in matching_backups(directory)[keep:]:
        old.unlink()
        removed.append(old)
    return removed


def copy_database(source: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(dest.parent, 0o700)
    if dest.exists():
        dest.unlink()
    src = sqlite3.connect(source)
    try:
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    os.chmod(dest, 0o600)
    with dest.open('rb') as handle:
        os.fsync(handle.fileno())


def integrity(path: Path) -> str:
    con = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    try:
        row = con.execute('PRAGMA integrity_check').fetchone()
    finally:
        con.close()
    return str(row[0]) if row else ''


def backup_once(source: Path = DB_PATH, directory: Path = BACKUP_DIR, now: datetime | None = None) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    stamp = (now or datetime.now(ZONE)).strftime('%Y%m%d-%H%M%S')
    final = directory / f'shirei-{stamp}.db'
    partial = directory / f'.shirei-{stamp}.db.partial'
    try:
        copy_database(source, partial)
        check = integrity(partial)
        if check != 'ok':
            raise RuntimeError(f'integrity_check={check}')
        os.replace(partial, final)
        os.chmod(final, 0o600)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    prune_backups(directory)
    return final


def note(line: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(LOG_PATH.parent, 0o700)
    with LOG_PATH.open('a', encoding='utf-8') as handle:
        handle.write(line.rstrip() + '\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(LOG_PATH, 0o600)
    print(line, flush=True)


def self_test() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / 'src.db'
        con = sqlite3.connect(source)
        con.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)')
        con.execute("INSERT INTO t (value) VALUES ('ok')")
        con.commit()
        con.close()
        dest_dir = root / 'backups'
        saved = backup_once(source, dest_dir, datetime(2026, 11, 9, 3, 15, tzinfo=ZONE))
        if integrity(saved) != 'ok':
            raise SystemExit('self-test integrity failed')
        copied = sqlite3.connect(f'file:{saved}?mode=ro', uri=True)
        try:
            value = copied.execute('SELECT value FROM t').fetchone()[0]
        finally:
            copied.close()
        if value != 'ok':
            raise SystemExit('self-test row missing')
        partials = list(dest_dir.glob('.*partial'))
        if partials:
            raise SystemExit('self-test left a partial file')
        for index in range(16):
            path = dest_dir / f'shirei-extra-{index:02d}.db'
            path.write_text('x', encoding='utf-8')
            os.utime(path, (1_700_000_000 + index, 1_700_000_000 + index))
        keeper = dest_dir / 'notes.txt'
        keeper.write_text('keep', encoding='utf-8')
        other = dest_dir / 'shirei-extra.db.bak'
        other.write_text('keep', encoding='utf-8')
        prune_backups(dest_dir, keep=14)
        left = {path.name for path in dest_dir.iterdir()}
        if 'notes.txt' not in left or 'shirei-extra.db.bak' not in left:
            raise SystemExit('self-test deleted a file outside shirei-*.db')
        kept = matching_backups(dest_dir)
        if len(kept) != 14:
            raise SystemExit(f'self-test kept {len(kept)}')
        if kept[-1].name == 'shirei-extra-00.db':
            raise SystemExit('self-test dropped a newer file')
    print('self-test ok')


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == '--self-test':
        self_test()
        return
    try:
        saved = backup_once()
        check = integrity(saved)
        note(f'backup ok {saved.name} bytes={saved.stat().st_size} integrity_check={check}')
    except Exception as err:
        note(f'backup failed {err.__class__.__name__}')
        raise


if __name__ == '__main__':
    main()
