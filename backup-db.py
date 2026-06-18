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
import json
import sqlite3
import requests
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = r"F:\zelzal prog-AI\Telegram-Bot\zelzal.db"
BACKUP_DIR = r"F:\zelzal prog-AI\Telegram-Bot\backups"
KEEP_DAYS = 30

# Google Drive settings (optional — only works if key file exists)
DRIVE_KEY_PATH = r"F:\zelzal prog-AI\Telegram-Bot\google-drive-key.json"
DRIVE_FOLDER_NAME = "ZELZAL_Backups"

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

def upload_to_drive(timestamp):
    """Upload backup files to Google Drive (optional)"""
    key_path = Path(DRIVE_KEY_PATH)
    if not key_path.exists():
        print("[DRIVE] No key file found — skipping Drive upload")
        print(f"[DRIVE] Create a service account key at {DRIVE_KEY_PATH} to enable")
        return False
    
    try:
        import json
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
        
        SCOPES = ['https://www.googleapis.com/auth/drive.file']
        creds = service_account.Credentials.from_service_account_file(str(key_path), scopes=SCOPES)
        service = build('drive', 'v3', credentials=creds)
        
        # Find or create backup folder
        folder_id = None
        results = service.files().list(
            q=f"name='{DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            spaces='drive', fields='files(id, name)'
        ).execute()
        folders = results.get('files', [])
        if folders:
            folder_id = folders[0]['id']
            print(f"[DRIVE] Found folder: {DRIVE_FOLDER_NAME} ({folder_id})")
        else:
            file_metadata = {'name': DRIVE_FOLDER_NAME, 'mimeType': 'application/vnd.google-apps.folder'}
            folder = service.files().create(body=file_metadata, fields='id').execute()
            folder_id = folder['id']
            print(f"[DRIVE] Created folder: {DRIVE_FOLDER_NAME} ({folder_id})")
        
        # Upload DB backup
        db_gz = Path(BACKUP_DIR) / f"zelzal_{timestamp}.db.gz"
        if db_gz.exists():
            media = MediaFileUpload(str(db_gz), mimetype='application/gzip', resumable=True)
            file_meta = {'name': db_gz.name, 'parents': [folder_id]}
            service.files().create(body=file_meta, media_body=media, fields='id').execute()
            print(f"[DRIVE] Uploaded: {db_gz.name}")
        
        # Upload code backups
        code_dir = Path(BACKUP_DIR) / "code"
        if code_dir.exists():
            for f in sorted(code_dir.glob(f"*_{timestamp}.*")):
                media = MediaFileUpload(str(f), resumable=True)
                file_meta = {'name': f.name, 'parents': [folder_id]}
                service.files().create(body=file_meta, media_body=media, fields='id').execute()
                print(f"[DRIVE] Uploaded: {f.name}")
        
        # Delete old backups (keep last 30)
        cutoff = datetime.now() - timedelta(days=KEEP_DAYS)
        results = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            spaces='drive', fields='files(id, name, createdTime)'
        ).execute()
        for f in results.get('files', []):
            try:
                ft = datetime.fromisoformat(f['createdTime'].replace('Z', '+00:00'))
                if ft < cutoff.replace(tzinfo=ft.tzinfo):
                    service.files().delete(fileId=f['id']).execute()
                    print(f"[DRIVE] Deleted old: {f['name']}")
            except:
                pass
        
        print("[DRIVE] Upload complete")
        return True
    
    except Exception as e:
        print(f"[DRIVE] Error: {e}")
        return False

def upload_to_telegram(timestamp):
    """Send backup files to admin via Telegram bot"""
    try:
        config_path = Path(r"F:\zelzal prog-AI\Telegram-Bot\config.json")
        if not config_path.exists():
            print("[TG] No config.json — skipping Telegram upload")
            return False
        with open(config_path) as f:
            cfg = json.load(f)
        token = cfg.get("bot_token", "")
        admin_ids = cfg.get("admin_ids", [])
        if not token or token == "YOUR_BOT_TOKEN_HERE" or not admin_ids:
            print("[TG] Invalid bot config — skipping")
            return False

        # Find latest backup files
        backup_dir = Path(BACKUP_DIR)
        db_file = backup_dir / f"zelzal_{timestamp}.db.gz"
        code_dir = backup_dir / "code"

        files_to_send = []
        if db_file.exists():
            files_to_send.append(("db", str(db_file)))
        if code_dir.exists():
            for f in sorted(code_dir.glob(f"*_{timestamp}.*"))[:7]:
                files_to_send.append(("code", str(f)))

        if not files_to_send:
            print("[TG] No backup files found")
            return False

        api = f"https://api.telegram.org/bot{token}"
        caption = f"📦 *باك أب ZELZAL* — {timestamp}"

        for file_type, file_path in files_to_send:
            fname = Path(file_path).name
            with open(file_path, "rb") as f:
                r = requests.post(f"{api}/sendDocument", data={
                    "chat_id": admin_ids[0],
                    "caption": f"{caption}\n`{fname}`" if len(files_to_send) <= 1 else f"📄 `{fname}`",
                    "parse_mode": "Markdown"
                }, files={"document": (fname, f)})
            if r.status_code == 200:
                print(f"[TG] Sent: {fname}")
            else:
                print(f"[TG] Failed: {fname} — {r.text[:100]}")

        if len(files_to_send) > 1:
            requests.post(f"{api}/sendMessage", json={
                "chat_id": admin_ids[0],
                "text": f"✅ {len(files_to_send)} ملف باك أب أرسلت — {timestamp}",
                "parse_mode": "Markdown"
            })

        return True
    except Exception as e:
        print(f"[TG] Error: {e}")
        return False

def main():
    print(f"=== ZELZAL Database Backup - {datetime.now()} ===")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_database()
    cleanup_old_backups()
    upload_to_drive(timestamp)
    upload_to_telegram(timestamp)
    print("=== Backup Complete ===")

if __name__ == "__main__":
    main()