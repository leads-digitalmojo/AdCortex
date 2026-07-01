#!/usr/bin/env python3
"""
Google Ads Negative Keyword Management — CLI Bridge
Adds/lists negative keywords via the Google Ads REST API v21.

Usage:
  python3 google_ads_negatives.py add --campaign-id 12345 --keyword "rent" --match-type PHRASE
  python3 google_ads_negatives.py add-shared --list-id 12345 --keyword "pg hostel" --match-type BROAD
  python3 google_ads_negatives.py list --campaign-id 12345
  python3 google_ads_negatives.py list-shared

Outputs JSON to stdout for easy parsing by Node.js.
"""

import argparse
import json
import sys
import os

# Re-use auth helpers from the existing API module
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)
from google_ads_api import _load_credentials, _get_access_token, gaql_search, BASE_URL

import requests

CUSTOMER_ID = "3120813693"
MCC_ID = ""

VALID_MATCH_TYPES = {"EXACT", "PHRASE", "BROAD"}


def _normalize_customer_id(value):
    if value is None:
        return ""
    return "".join(ch for ch in str(value) if ch.isdigit())


def _headers(customer_id=None):
    """Build authenticated headers for Google Ads API requests."""
    creds = _load_credentials()
    access_token = _get_access_token(creds)
    cid = _normalize_customer_id(customer_id or CUSTOMER_ID)
    login_id = _normalize_customer_id(creds.get("login_customer_id", MCC_ID))
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": creds["developer_token"],
        "Content-Type": "application/json",
    }
    if login_id and login_id != cid:
        headers["login-customer-id"] = login_id
    return headers


def _mutate(endpoint_path, body, customer_id=None):
    """Generic mutate helper — POST to a Google Ads mutate endpoint."""
    cid = _normalize_customer_id(customer_id or CUSTOMER_ID)
    url = f"{BASE_URL}/customers/{cid}/{endpoint_path}"
    resp = requests.post(url, headers=_headers(cid), json=body, timeout=60)
    if resp.status_code != 200:
        error_detail = ""
        try:
            err_data = resp.json()
            errors = err_data.get("error", {}).get("details", [{}])
            for detail in errors:
                for err in detail.get("errors", []):
                    error_detail += f" [{err.get('errorCode', {})}] {err.get('message', '')}"
        except Exception:
            error_detail = resp.text[:500]
        return {"success": False, "error": f"HTTP {resp.status_code}: {error_detail}"}
    return {"success": True, "data": resp.json()}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Command: add — Add a campaign-level negative keyword
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def cmd_add(args):
    """Add a negative keyword to a specific campaign."""
    campaign_id = args.campaign_id
    keyword = args.keyword
    match_type = args.match_type.upper()

    if match_type not in VALID_MATCH_TYPES:
        print(json.dumps({"success": False, "error": f"Invalid match type: {match_type}. Must be one of {list(VALID_MATCH_TYPES)}"}))
        sys.exit(1)

    cid = args.customer_id or CUSTOMER_ID
    resource_name = f"customers/{cid}/campaigns/{campaign_id}"

    body = {
        "operations": [
            {
                "create": {
                    "campaign": resource_name,
                    "negative": True,
                    "keyword": {
                        "text": keyword,
                        "matchType": match_type,
                    },
                }
            }
        ],
    }

    result = _mutate("campaignCriteria:mutate", body, customer_id=cid)

    if result["success"]:
        mutate_results = result["data"].get("results", [])
        resource = mutate_results[0].get("resourceName", "") if mutate_results else ""
        print(json.dumps({
            "success": True,
            "message": f"Added negative keyword '{keyword}' ({match_type}) to campaign {campaign_id}",
            "resourceName": resource,
        }))
    else:
        print(json.dumps(result))
        sys.exit(1)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Command: add-bulk — Add multiple negative keywords to a campaign
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def cmd_add_bulk(args):
    """Add multiple negative keywords to a campaign at once.
    
    Expects --keywords-json as a JSON string:
      [{"keyword": "rent", "matchType": "PHRASE"}, ...]
    """
    campaign_id = args.campaign_id
    cid = args.customer_id or CUSTOMER_ID
    resource_name = f"customers/{cid}/campaigns/{campaign_id}"

    try:
        keywords = json.loads(args.keywords_json)
    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON for --keywords-json: {str(e)}"}))
        sys.exit(1)

    if not isinstance(keywords, list) or len(keywords) == 0:
        print(json.dumps({"success": False, "error": "keywords-json must be a non-empty array"}))
        sys.exit(1)

    operations = []
    for kw in keywords:
        kw_text = kw.get("keyword", "").strip()
        kw_match = kw.get("matchType", "BROAD").upper()
        if not kw_text:
            continue
        if kw_match not in VALID_MATCH_TYPES:
            kw_match = "BROAD"
        operations.append({
            "create": {
                "campaign": resource_name,
                "negative": True,
                "keyword": {
                    "text": kw_text,
                    "matchType": kw_match,
                },
            }
        })

    if not operations:
        print(json.dumps({"success": False, "error": "No valid keywords in the input"}))
        sys.exit(1)

    body = {"operations": operations}
    result = _mutate("campaignCriteria:mutate", body, customer_id=cid)

    if result["success"]:
        mutate_results = result["data"].get("results", [])
        print(json.dumps({
            "success": True,
            "message": f"Added {len(mutate_results)} negative keywords to campaign {campaign_id}",
            "count": len(mutate_results),
            "resourceNames": [r.get("resourceName", "") for r in mutate_results],
        }))
    else:
        print(json.dumps(result))
        sys.exit(1)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Command: add-shared — Add to a shared negative keyword list
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def cmd_add_shared(args):
    """Add a keyword to a shared negative keyword list."""
    list_id = args.list_id
    keyword = args.keyword
    match_type = args.match_type.upper()

    if match_type not in VALID_MATCH_TYPES:
        print(json.dumps({"success": False, "error": f"Invalid match type: {match_type}. Must be one of {list(VALID_MATCH_TYPES)}"}))
        sys.exit(1)

    cid = args.customer_id or CUSTOMER_ID
    shared_set_resource = f"customers/{cid}/sharedSets/{list_id}"

    body = {
        "operations": [
            {
                "create": {
                    "sharedSet": shared_set_resource,
                    "keyword": {
                        "text": keyword,
                        "matchType": match_type,
                    },
                }
            }
        ],
    }

    result = _mutate("sharedCriteria:mutate", body, customer_id=cid)

    if result["success"]:
        mutate_results = result["data"].get("results", [])
        resource = mutate_results[0].get("resourceName", "") if mutate_results else ""
        print(json.dumps({
            "success": True,
            "message": f"Added '{keyword}' ({match_type}) to shared negative list {list_id}",
            "resourceName": resource,
        }))
    else:
        print(json.dumps(result))
        sys.exit(1)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Command: list — List campaign-level negative keywords
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def cmd_list(args):
    """List negative keywords for a campaign."""
    campaign_id = args.campaign_id
    cid = args.customer_id or CUSTOMER_ID

    gaql = (
        "SELECT campaign_criterion.keyword.text, "
        "campaign_criterion.keyword.match_type, "
        "campaign_criterion.criterion_id, "
        "campaign.id, campaign.name "
        "FROM campaign_criterion "
        f"WHERE campaign_criterion.negative = TRUE AND campaign.id = {campaign_id}"
    )

    results = gaql_search(gaql, customer_id=cid)

    if isinstance(results, dict) and "_error" in results:
        print(json.dumps({"success": False, "error": results["_error"]}))
        sys.exit(1)

    negatives = []
    for row in results:
        cc = row.get("campaignCriterion", {})
        kw = cc.get("keyword", {})
        campaign = row.get("campaign", {})
        negatives.append({
            "criterionId": cc.get("criterionId", ""),
            "keyword": kw.get("text", ""),
            "matchType": kw.get("matchType", ""),
            "campaignId": campaign.get("id", ""),
            "campaignName": campaign.get("name", ""),
        })

    print(json.dumps({
        "success": True,
        "campaignId": campaign_id,
        "count": len(negatives),
        "negatives": negatives,
    }))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Command: list-shared — List shared negative keyword lists
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def cmd_list_shared(args):
    """List shared negative keyword lists at account level."""
    cid = args.customer_id or CUSTOMER_ID

    gaql = (
        "SELECT shared_set.id, shared_set.name, shared_set.type, "
        "shared_set.status, shared_set.member_count "
        "FROM shared_set "
        "WHERE shared_set.type = 'NEGATIVE_KEYWORDS'"
    )

    results = gaql_search(gaql, customer_id=cid)

    if isinstance(results, dict) and "_error" in results:
        print(json.dumps({"success": False, "error": results["_error"]}))
        sys.exit(1)

    lists = []
    for row in results:
        ss = row.get("sharedSet", {})
        lists.append({
            "id": ss.get("id", ""),
            "name": ss.get("name", ""),
            "type": ss.get("type", ""),
            "status": ss.get("status", ""),
            "memberCount": ss.get("memberCount", 0),
        })

    print(json.dumps({
        "success": True,
        "count": len(lists),
        "sharedSets": lists,
    }))


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CLI entry point
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def main():
    parser = argparse.ArgumentParser(description="Google Ads Negative Keyword Management")
    parser.add_argument("--customer-id", default=None, help=f"Google Ads customer ID (default: {CUSTOMER_ID})")
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # add
    add_parser = subparsers.add_parser("add", help="Add a campaign-level negative keyword")
    add_parser.add_argument("--campaign-id", required=True, help="Campaign ID")
    add_parser.add_argument("--keyword", required=True, help="Keyword text")
    add_parser.add_argument("--match-type", default="BROAD", help="Match type: EXACT, PHRASE, or BROAD")

    # add-bulk
    bulk_parser = subparsers.add_parser("add-bulk", help="Add multiple campaign-level negative keywords")
    bulk_parser.add_argument("--campaign-id", required=True, help="Campaign ID")
    bulk_parser.add_argument("--keywords-json", required=True, help='JSON array of {keyword, matchType}')

    # add-shared
    shared_parser = subparsers.add_parser("add-shared", help="Add to a shared negative keyword list")
    shared_parser.add_argument("--list-id", required=True, help="Shared set (list) ID")
    shared_parser.add_argument("--keyword", required=True, help="Keyword text")
    shared_parser.add_argument("--match-type", default="BROAD", help="Match type: EXACT, PHRASE, or BROAD")

    # list
    list_parser = subparsers.add_parser("list", help="List negative keywords for a campaign")
    list_parser.add_argument("--campaign-id", required=True, help="Campaign ID")

    # list-shared
    subparsers.add_parser("list-shared", help="List shared negative keyword lists")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "add": cmd_add,
        "add-bulk": cmd_add_bulk,
        "add-shared": cmd_add_shared,
        "list": cmd_list,
        "list-shared": cmd_list_shared,
    }

    try:
        commands[args.command](args)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
