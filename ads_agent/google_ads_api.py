#!/usr/bin/env python3
"""
Google Ads REST API Direct Client
Replaces broken Pipedream connector with direct Google Ads API calls.

Uses OAuth2 refresh token flow for authentication.
Supports multiple clients via credentials file.
"""

import json
import os
import time
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CREDS_FILE = os.path.join(SCRIPT_DIR, "google_ads_credentials.json")
TOKEN_CACHE_FILE = os.path.join(SCRIPT_DIR, ".google_ads_token_cache.json")

API_VERSION = "v21"
BASE_URL = f"https://googleads.googleapis.com/{API_VERSION}"
TOKEN_URL = "https://oauth2.googleapis.com/token"

# Default GAQL field sets for common resource types
CAMPAIGN_FIELDS = """
    campaign.id, campaign.name, campaign.status,
    campaign.advertising_channel_type, campaign.bidding_strategy_type,
    campaign.target_cpa.target_cpa_micros,
    campaign.maximize_conversions.target_cpa_micros,
    campaign.maximize_conversion_value.target_roas,
    campaign_budget.amount_micros,
    segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.all_conversions,
    metrics.ctr, metrics.average_cpc, metrics.average_cpm,
    metrics.cost_per_conversion,
    metrics.search_impression_share,
    metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share,
    metrics.search_absolute_top_impression_share,
    metrics.search_top_impression_share,
    metrics.search_click_share,
    metrics.search_exact_match_impression_share,
    metrics.phone_impressions,
    metrics.phone_calls
"""

AD_GROUP_FIELDS = """
    ad_group.id, ad_group.name, ad_group.status,
    campaign.id, campaign.name, campaign.advertising_channel_type,
    segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.all_conversions,
    metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion,
    metrics.search_impression_share,
    metrics.search_top_impression_share
"""

AD_FIELDS = """
    ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
    ad_group_ad.ad_strength,
    ad_group_ad.ad.type,
    ad_group_ad.ad.responsive_search_ad.headlines,
    ad_group_ad.ad.responsive_search_ad.descriptions,
    ad_group_ad.ad.final_urls,
    ad_group.id, ad_group.name,
    campaign.id, campaign.name, campaign.advertising_channel_type,
    segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.all_conversions,
    metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion,
    metrics.video_views, metrics.video_view_rate,
    metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate,
    metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate
"""

CUSTOMER_FIELDS = """
    customer.id, customer.descriptive_name, customer.currency_code,
    customer.time_zone,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.all_conversions
"""

# Map resource type to default fields
DEFAULT_FIELDS = {
    "campaign": CAMPAIGN_FIELDS,
    "ad_group": AD_GROUP_FIELDS,
    "ad_group_ad": AD_FIELDS,
    "customer": CUSTOMER_FIELDS,
}


def _normalize_customer_id(value):
    """Return a Google Ads account ID with only digits."""
    if value is None:
        return ""
    return "".join(ch for ch in str(value) if ch.isdigit())


def _load_credentials():
    """Load Google Ads API credentials from env vars (preferred) or file fallback."""
    # Prefer environment variables (for production / Render deployment)
    if os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"):
        return {
            "client_id": os.environ["GOOGLE_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
            "refresh_token": os.environ.get("GOOGLE_REFRESH_TOKEN", ""),
            "developer_token": os.environ.get("GOOGLE_DEVELOPER_TOKEN", ""),
            "login_customer_id": _normalize_customer_id(os.environ.get("GOOGLE_MCC_ID", "")),
            "default_client_id": _normalize_customer_id(os.environ.get("GOOGLE_CUSTOMER_ID", "")),
        }
    # Fallback to credentials JSON file (for local development)
    if not os.path.exists(CREDS_FILE):
        raise FileNotFoundError(
            f"Google Ads credentials not found. Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET "
            f"env vars or create {CREDS_FILE}."
        )
    with open(CREDS_FILE) as f:
        creds = json.load(f)
    creds["login_customer_id"] = _normalize_customer_id(creds.get("login_customer_id", ""))
    creds["default_client_id"] = _normalize_customer_id(creds.get("default_client_id", ""))
    return creds


def _get_access_token(creds):
    """Get a valid access token, using cache if not expired."""
    # Check cache
    if os.path.exists(TOKEN_CACHE_FILE):
        try:
            with open(TOKEN_CACHE_FILE) as f:
                cache = json.load(f)
            if cache.get("expires_at", 0) > time.time() + 60:  # 60s buffer
                return cache["access_token"]
        except (json.JSONDecodeError, KeyError):
            pass

    # Refresh token
    resp = requests.post(TOKEN_URL, data={
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": creds["refresh_token"],
        "grant_type": "refresh_token",
    }, timeout=30)

    if resp.status_code != 200:
        details = resp.text[:300]
        if resp.status_code == 400 and "invalid_grant" in details:
            raise RuntimeError(
                "Token refresh failed: 400 invalid_grant. "
                "The refresh token is rejected by Google. This is usually caused by "
                "a revoked/expired refresh token, a refresh token generated for a different "
                "OAuth client_id/client_secret, or an OAuth consent screen still in Testing mode. "
                f"Raw response: {details}"
            )
        raise RuntimeError(f"Token refresh failed: {resp.status_code} - {details}")

    data = resp.json()
    access_token = data["access_token"]
    expires_in = data.get("expires_in", 3600)

    # Cache it
    cache = {
        "access_token": access_token,
        "expires_at": time.time() + expires_in,
    }
    with open(TOKEN_CACHE_FILE, "w") as f:
        json.dump(cache, f)

    return access_token


def gaql_search(query, customer_id=None, login_customer_id=None, page_size=10000):
    """Execute a GAQL query against the Google Ads API.
    
    Args:
        query: GAQL query string
        customer_id: Client account ID (no dashes). Defaults to creds file.
        login_customer_id: MCC account ID (no dashes). Defaults to creds file.
        page_size: Max rows per page (default 10000)
    
    Returns:
        List of result rows (dicts with camelCase keys matching Google Ads API format)
    """
    creds = _load_credentials()
    access_token = _get_access_token(creds)
    
    cid = _normalize_customer_id(customer_id or creds.get("default_client_id") or "3120813693")
    login_id = _normalize_customer_id(login_customer_id or creds.get("login_customer_id", ""))

    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": creds["developer_token"],
        "Content-Type": "application/json",
    }
    if login_id and str(login_id).strip() != str(cid).strip():
        headers["login-customer-id"] = str(login_id).strip()

    all_results = []
    next_page_token = None

    while True:
        body = {"query": query.strip()}
        if next_page_token:
            body["pageToken"] = next_page_token

        resp = requests.post(
            f"{BASE_URL}/customers/{cid}/googleAds:search",
            headers=headers,
            json=body,
            timeout=120,
        )

        if resp.status_code != 200:
            error_detail = ""
            try:
                err_data = resp.json()
                errors = err_data.get("error", {}).get("details", [{}])
                if errors:
                    for detail in errors:
                        for err in detail.get("errors", []):
                            error_detail += f" [{err.get('errorCode', {})}] {err.get('message', '')}"
            except:
                error_detail = resp.text[:500]
            
            return {"_error": f"HTTP {resp.status_code}: {error_detail}"}

        data = resp.json()
        results = data.get("results", [])
        all_results.extend(results)

        next_page_token = data.get("nextPageToken")
        if not next_page_token:
            break

    return all_results


def get_report(resource, since=None, until=None, query=None, customer_id=None):
    """Pull a Google Ads report — drop-in replacement for the old Pipedream-based get_report.
    
    Args:
        resource: Google Ads resource type (campaign, ad_group, ad_group_ad, customer, 
                  keyword_view, search_term_view, age_range_view, gender_view, etc.)
        since: Start date (YYYY-MM-DD)
        until: End date (YYYY-MM-DD) 
        query: Optional raw GAQL query (overrides auto-generated query)
        customer_id: Optional client account ID override
    
    Returns:
        List of result rows (matching old Pipedream format) or error dict
    """
    if query:
        # Raw GAQL provided — use as-is but add date filter if dates given and not already in query
        gaql = query
        if since and until and "segments.date" not in query.lower():
            connector = " AND" if "WHERE" in gaql.upper() else " WHERE"
            gaql += f"{connector} segments.date BETWEEN '{since}' AND '{until}'"
    else:
        # Auto-build query from resource type
        fields = DEFAULT_FIELDS.get(resource)
        if not fields:
            return {"_error": f"Unknown resource type: {resource}. Provide a raw GAQL query instead."}
        
        gaql = f"SELECT {fields.strip()} FROM {resource}"
        
        # Add status filter for non-customer resources
        if resource != "customer":
            if resource == "campaign":
                gaql += " WHERE campaign.status != 'REMOVED'"
            elif resource == "ad_group":
                gaql += " WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'"
            elif resource == "ad_group_ad":
                gaql += " WHERE ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'"
        
        # Add date range
        if since and until and resource != "customer":
            connector = " AND" if "WHERE" in gaql else " WHERE"
            gaql += f"{connector} segments.date BETWEEN '{since}' AND '{until}'"
    
    return gaql_search(gaql, customer_id=customer_id)


# ━━━━━━━━━━━━━━━━ ACTION HELPERS (for dashboard execution) ━━━━━━━━━━━━━━━━

def mutate_campaign(customer_id, campaign_id, operations, login_customer_id=None):
    """Mutate a campaign (e.g., pause, enable, update budget).
    
    Args:
        customer_id: Client account ID
        campaign_id: Campaign resource name or ID
        operations: List of operation dicts
        login_customer_id: MCC account ID
    
    Returns:
        API response dict
    """
    creds = _load_credentials()
    access_token = _get_access_token(creds)
    customer_id = _normalize_customer_id(customer_id)
    login_id = _normalize_customer_id(login_customer_id or creds.get("login_customer_id", ""))
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": creds["developer_token"],
        "Content-Type": "application/json",
    }
    if login_id and str(login_id).strip() != str(customer_id).strip():
        headers["login-customer-id"] = str(login_id).strip()
    
    resp = requests.post(
        f"{BASE_URL}/customers/{customer_id}/campaigns:mutate",
        headers=headers,
        json={"operations": operations},
        timeout=60,
    )
    
    if resp.status_code != 200:
        return {"_error": f"Mutate failed: {resp.status_code} - {resp.text[:500]}"}
    
    return resp.json()


def mutate_ad_group(customer_id, operations, login_customer_id=None):
    """Mutate ad groups."""
    creds = _load_credentials()
    access_token = _get_access_token(creds)
    customer_id = _normalize_customer_id(customer_id)
    login_id = _normalize_customer_id(login_customer_id or creds.get("login_customer_id", ""))
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": creds["developer_token"],
        "Content-Type": "application/json",
    }
    if login_id and str(login_id).strip() != str(customer_id).strip():
        headers["login-customer-id"] = str(login_id).strip()
    
    resp = requests.post(
        f"{BASE_URL}/customers/{customer_id}/adGroups:mutate",
        headers=headers,
        json={"operations": operations},
        timeout=60,
    )
    
    if resp.status_code != 200:
        return {"_error": f"Mutate failed: {resp.status_code} - {resp.text[:500]}"}
    
    return resp.json()


def mutate_ad(customer_id, operations, login_customer_id=None):
    """Mutate ads (pause/enable)."""
    creds = _load_credentials()
    access_token = _get_access_token(creds)
    customer_id = _normalize_customer_id(customer_id)
    login_id = _normalize_customer_id(login_customer_id or creds.get("login_customer_id", ""))
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": creds["developer_token"],
        "Content-Type": "application/json",
    }
    if login_id and str(login_id).strip() != str(customer_id).strip():
        headers["login-customer-id"] = str(login_id).strip()
    
    resp = requests.post(
        f"{BASE_URL}/customers/{customer_id}/adGroupAds:mutate",
        headers=headers,
        json={"operations": operations},
        timeout=60,
    )
    
    if resp.status_code != 200:
        return {"_error": f"Mutate failed: {resp.status_code} - {resp.text[:500]}"}
    
    return resp.json()


def mutate_campaign_budget(customer_id, budget_resource_name, new_amount_micros, login_customer_id=None):
    """Update a campaign budget amount."""
    creds = _load_credentials()
    access_token = _get_access_token(creds)
    customer_id = _normalize_customer_id(customer_id)
    login_id = _normalize_customer_id(login_customer_id or creds.get("login_customer_id", ""))
    
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": creds["developer_token"],
        "Content-Type": "application/json",
    }
    if login_id and str(login_id).strip() != str(customer_id).strip():
        headers["login-customer-id"] = str(login_id).strip()
    
    resp = requests.post(
        f"{BASE_URL}/customers/{customer_id}/campaignBudgets:mutate",
        headers=headers,
        json={
            "operations": [{
                "update": {
                    "resourceName": budget_resource_name,
                    "amountMicros": str(new_amount_micros),
                },
                "updateMask": "amount_micros",
            }]
        },
        timeout=60,
    )
    
    if resp.status_code != 200:
        return {"_error": f"Budget update failed: {resp.status_code} - {resp.text[:500]}"}
    
    return resp.json()


# ━━━━━━━━━━━━━━━━ QUICK TEST ━━━━━━━━━━━━━━━━

if __name__ == "__main__":
    import sys
    
    print("Testing Google Ads Direct API...")
    
    # Test campaign query
    results = get_report("campaign", since="2026-03-12", until="2026-03-19")
    if isinstance(results, dict) and "_error" in results:
        print(f"ERROR: {results['_error']}")
        sys.exit(1)
    
    print(f"SUCCESS: Got {len(results)} campaign rows")
    
    # Show active campaigns
    active = [r for r in results if r.get("campaign", {}).get("status") == "ENABLED"]
    print(f"Active campaigns: {len(active)}")
    for r in active:
        camp = r.get("campaign", {})
        m = r.get("metrics", {})
        cost = int(m.get("costMicros", 0)) / 1e6
        conv = float(m.get("conversions", 0))
        cpl = cost / conv if conv > 0 else 0
        print(f"  {camp.get('name')}: ₹{cost:,.0f} | {conv:.0f} conv | ₹{cpl:,.0f} CPL")
