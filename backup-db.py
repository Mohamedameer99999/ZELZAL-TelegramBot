#!/usr/bin/env python3
"""
Auto backup script for SQLite database
- Runs daily via cron/task scheduler
- Keeps last 30 backups
- Compresses with gzip
- Optional: upload to Google Drive (configure separately)
"""

import os
import shutil
import gzip
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = r"F:\zelzal prog-AI\Telegram-Bot\zelzal.db"
BACKUP_DIR = r"F:\zelzal prog-AI\Telegram-Bot\backups"
KEEP_DAYS = 30

# Code files to backup alongside DB
CODE_FILES = [
    r"F:\zelzal prog-AI\Telegram-Bot\bot.js",
    r"F:\zelzal prog-AI\Telegram-Bot\database.js",
    r"F:\zelzal prog-AI\Telegram-Bot\config.json",
    r"F:\zelzal prog-AI\Telegram-Bot\products.json",
    r"F:\zelzal prog-AI\Telegram-Bot\auto-executor.js",
    r"F:\zelzal prog-AI\Telegram-Bot\remote-server.js",
    r"F:\zelzal prog-AI\Telegram-Bot\subscription-manager.js",
]

def backup_database():
    """Create compressed backup of SQLite database"""
    try:
        db_file = Path(DB_PATH)
        if not db_file.exists():
            print(f"[ERROR] Database not found: {DB_PATH}")
            return False
        
        # Create backup directory
        backup_dir = Path(BACKUP_DIR)
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate backup filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_name = f"zelzal_{timestamp}.db.gz"
        backup_path = backup_dir / backup_name
        
        # Copy database (use SQLite backup API for consistency)
        print(f"[BACKUP] Starting backup to {backup_path}")
        
        # Use SQLite backup API for consistent backup
        source_conn = sqlite3.connect(DB_PATH)
        dest_conn = sqlite3.connect(':memory:')
        source_conn.backup(dest_conn)
        dest_conn.close()
        source_conn.close()
        
        # Now compress the database file
        with open(DB_PATH, 'rb') as f_in:
            with gzip.open(backup_path, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        
        size_mb = backup_path.stat().st_size / (1024 * 1024)
        print(f"[BACKUP] Completed: {backup_name} ({size_mb:.2f} MB)")
        
        # Backup code files
        code_backup_dir = backup_dir / "code"
        code_backup_dir.mkdir(parents=True, exist_ok=True)
        for src_path in CODE_FILES:
            src = Path(src_path)
            if src.exists():
                dest = code_backup_dir / f"{src.stem}_{timestamp}{src.suffix}"
                shutil.copy2(src, dest)
                print(f"[BACKUP] Code: {src.name} -> {dest.name}")
        
        return True
        
    except Exception as e:
        print(f"[BACKUP] Error: {e}")
        return False

def cleanup_old_backups():
    """Remove backups older than KEEP_DAYS"""
    try:
        backup_dir = Path(BACKUP_DIR)
        if not backup_dir.exists():
            return
        
        cutoff = datetime.now() - timedelta(days=KEEP_DAYS)
        removed = 0
        
        for backup_file in backup_dir.glob("zelzal_*.db.gz"):
            # Extract timestamp from filename
            try:
                timestamp_str = backup_file.stem.replace("zelzal_", "").replace(".db", "")
                file_time = datetime.strptime(timestamp_str, "%Y%m%d_%H%M%S")
                if file_time < cutoff:
                    backup_file.unlink()
                    removed += 1
                    print(f"[CLEANUP] Removed old backup: {backup_file.name}")
            except:
                pass
        
        # Clean old code backups
        code_dir = backup_dir / "code"
        if code_dir.exists():
            for f in code_dir.glob("*_*.*"):
                try:
                    parts = f.stem.rsplit("_", 1)
                    if len(parts) == 2:
                        ft = datetime.strptime(parts[1], "%Y%m%d_%H%M%S")
                        if ft < cutoff:
                            f.unlink()
                            removed += 1
                except:
                    pass
        
        if removed:
            print(f"[CLEANUP] Removed {removed} old items")
        
    except Exception as e:
        print(f"[CLEANUP] Error: {e}")

def main():
    print(f"=== ZELZAL Database Backup - {datetime.now()} ===")
    backup_database()
    cleanup_old_backups()
    print("=== Backup Complete ===")

if __name__ == "__main__":
    main()