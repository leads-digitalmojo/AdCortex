import os
import sys
import json
import requests

# Add root directory to sys.path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, root_dir)

try:
    from ads_agent.google_ads_api import _load_credentials, _get_access_token, BASE_URL
except ImportError as e:
    print(f"Import Error: {e}")
    print(f"Current sys.path: {sys.path}")
    sys.exit(1)

def list_accessible_customers():
    try:
        creds = _load_credentials()
        access_token = _get_access_token(creds)
        
        headers = {
            "Authorization": f"Bearer {access_token}",
            "developer-token": creds["developer_token"],
            "Content-Type": "application/json",
        }
        
        url = f"{BASE_URL}/customers:listAccessibleCustomers"
        resp = requests.get(url, headers=headers)
        
        if resp.status_code == 200:
            print("Accessible Customers:", json.dumps(resp.json(), indent=2))
        else:
            print(f"Error {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"Python Error: {e}")

if __name__ == "__main__":
    list_accessible_customers()
