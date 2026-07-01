#!/usr/bin/env python3
import os
import json
import psycopg2
from urllib.parse import urlparse
from dotenv import load_dotenv

# Load ENV
load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("[SKIP] No DATABASE_URL found. Skipping DB sync.")
    exit(0)

# ─── 1. Connect to Database ───
try:
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    cur = conn.cursor()
    print("[DB] Connected to database.")
except Exception as e:
    print(f"[ERROR] Failed to connect to DB: {e}")
    exit(1)

# ─── 2. Fetch Clients Registry ───
try:
    cur.execute("SELECT id, name, short_name, project, location, target_locations, platforms, targets, created_at FROM clients")
    rows = cur.fetchall()
    registry = []
    for row in rows:
        registry.append({
            "id": row[0],
            "name": row[1],
            "shortName": row[2],
            "project": row[3],
            "location": row[4],
            "targetLocations": row[5],
            "platforms": row[6],
            "targets": row[7],
            "createdAt": row[8].isoformat() if row[8] else None
        })
    
    reg_path = os.path.join(os.path.dirname(__file__), "data", "clients_registry.json")
    os.makedirs(os.path.dirname(reg_path), exist_ok=True)
    with open(reg_path, "w") as f:
        json.dump(registry, f, indent=2)
    print(f"[SYNC] Fetched {len(registry)} clients into registry.")

except Exception as e:
    print(f"[ERROR] Registry sync failed: {e}")

# ─── 3. Fetch Client Credentials ───
try:
    cur.execute("SELECT client_id, meta, google, updated_at FROM client_credentials")
    rows = cur.fetchall()
    creds = []
    for row in rows:
        creds.append({
            "clientId": row[0],
            "meta": row[1],
            "google": row[2],
            "updatedAt": row[3].isoformat() if row[3] else None
        })
    
    creds_path = os.path.join(os.path.dirname(__file__), "data", "clients_credentials.json")
    with open(creds_path, "w") as f:
        json.dump(creds, f, indent=2)
    print(f"[SYNC] Fetched {len(creds)} client credentials.")

except Exception as e:
    print(f"[ERROR] Credentials sync failed: {e}")

# Cleanup
cur.close()
conn.close()
print("[DONE] Client data synced successfully.")
