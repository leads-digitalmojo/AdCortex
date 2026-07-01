import requests
import json
import os

TOKEN_URL = "https://oauth2.googleapis.com/token"
client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "")
refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN", "")

if not all([client_id, client_secret, refresh_token]):
    print("ERROR: Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN env vars first.")
    exit(1)

payload = {
    "client_id": client_id,
    "client_secret": client_secret,
    "refresh_token": refresh_token,
    "grant_type": "refresh_token",
}

print("Testing Google Token Refresh...")
resp = requests.post(TOKEN_URL, data=payload)
print(f"Status: {resp.status_code}")
print(f"Response: {resp.text}")
