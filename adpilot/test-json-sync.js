import fs from "fs";
import path from "path";
const dir = "../ads_agent/data";
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const creds = [
  {
    "clientId": "revasa-aura",
    "meta": {
      "accessToken": "EAAOzdNHQitQBRAChFwiQZCzCcPrCvfhZBwXxsCVIuCxFg4DUSNTPuiUz5GxjYnaYX1kSExPl967VSCBykjshlvaNZAQnl4LBXPhwdNU0EcCtsRPK1Q8ThND0usRsnkynBSSk7ZC0aT7iIsthZBqEVUsyvVh8SGUCf84yYuhp3sO8ZBePrc7LHMwBwjyhcdgt178QZDZD",
      "adAccountId": "act_1386728895211519"
    }
  }
];
const registry = [
  {
    "id": "revasa-aura",
    "name": "Revasa Aura",
    "shortName": "Revasa Aura",
    "project": "Revasa Aura",
    "location": "Hyderabad",
    "targetLocations": [],
    "platforms": {
      "meta": { "enabled": true, "dataPath": "/Users/apple/Downloads/AdPilot-V3-Complete-Final/ads_agent/data/clients/revasa-aura/meta/analysis.json", "label": "Meta Ads" }
    },
    "targets": {}
  }
];

fs.writeFileSync(path.join(dir, "clients_credentials.json"), JSON.stringify(creds, null, 2));
fs.writeFileSync(path.join(dir, "clients_registry.json"), JSON.stringify(registry, null, 2));
console.log("Wrote JSONs");
