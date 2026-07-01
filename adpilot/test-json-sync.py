import json, os
dir = "../ads_agent/data"
os.makedirs(dir, exist_ok=True)

creds = [
  {
    "clientId": "revasa-aura",
    "meta": {
      "accessToken": "EAAOzdNHQitQBRAChFwiQZCzCcPrCvfhZBwXxsCVIuCxFg4DUSNTPuiUz5GxjYnaYX1kSExPl967VSCBykjshlvaNZAQnl4LBXPhwdNU0EcCtsRPK1Q8ThND0usRsnkynBSSk7ZC0aT7iIsthZBqEVUsyvVh8SGUCf84yYuhp3sO8ZBePrc7LHMwBwjyhcdgt178QZDZD",
      "adAccountId": "act_1386728895211519"
    }
  }
]
registry = [
  {
    "id": "revasa-aura",
    "name": "Revasa Aura",
    "shortName": "Revasa Aura",
    "project": "Revasa Aura",
    "location": "Hyderabad",
    "targetLocations": [],
    "platforms": {
      "meta": { "enabled": True, "dataPath": "/Users/apple/Downloads/AdPilot-V3-Complete-Final/ads_agent/data/clients/revasa-aura/meta/analysis.json", "label": "Meta Ads" }
    },
    "targets": {}
  }
]

with open(f"{dir}/clients_credentials.json", "w") as f: json.dump(creds, f)
with open(f"{dir}/clients_registry.json", "w") as f: json.dump(registry, f)
print("Wrote JSONs")
