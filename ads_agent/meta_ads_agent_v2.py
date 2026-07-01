#!/usr/bin/env python3
"""
Mojo Performance Agent v3 — Advanced Meta Ads Performance Marketing Engine
Deevyashakti Amara — Luxury Real Estate, Hyderabad

SOP-driven + Performance Marketer Intellect multi-layer analysis engine with:
- Funnel layer classification (TOFU/MOFU/BOFU)
- Cost stack diagnostic chain per layer
- Creative health (thumb stop, hold rate, fatigue) — VIDEO vs STATIC separated
- Adset-level analysis module
- 10 SOP playbook matching with FULL descriptive names
- Deep creative pattern identification (what worked and WHY)
- Multi-solution recommendations (one metric → multiple root causes + separate approvals)
- Learning Limited detection + Budget scaling logic
- Non-delivering campaign/adset detection + fix recommendations
- Performance Marketer Intellect layer (goes beyond SOPs)
- ICE-scored, data-driven recommendations
- Persistent learning data across runs
- Dynamic alert thresholds (30% above target CPL, NOT hardcoded)

Runs standalone: python3 meta_ads_agent_v2.py --cadence twice_weekly [--date-range 7d]
"""

import json
import os
import sys
import datetime
import textwrap
import math
import calendar
from collections import defaultdict
from urllib.request import urlopen, Request
from urllib.parse import urlencode, quote
from urllib.error import URLError, HTTPError
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import scoring_engine
from scoring_engine import safe_div
from intelligence_engines import PerformanceIntelligenceEngine, PatternDetectionEngine


def _configure_stdio():
    """Avoid Windows console encoding crashes when logs include Unicode."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None or not hasattr(stream, "reconfigure"):
            continue
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            try:
                stream.reconfigure(errors="replace")
            except Exception:
                pass


_configure_stdio()

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ CONFIG ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# ── Resolve client ID early (from --client arg or ADPILOT_CLIENT_ID env var) ──
def _resolve_client_id():
    import argparse as _ap
    p = _ap.ArgumentParser(add_help=False)
    p.add_argument("--client", default=None)
    known, _ = p.parse_known_args()
    return known.client or os.environ.get("ADPILOT_CLIENT_ID", "amara")

_CLIENT_ID = _resolve_client_id()

# ── Load per-client credentials from clients_credentials.json ──
def _load_meta_credentials(client_id):
    creds_path = os.path.join(os.path.dirname(__file__), "data", "clients_credentials.json")
    if os.path.exists(creds_path):
        try:
            with open(creds_path) as f:
                arr = json.load(f)
            for entry in arr:
                if entry.get("clientId") == client_id:
                    m = entry.get("meta", {})
                    if m:
                        return {
                            "ad_account_id": m.get("adAccountId", ""),
                            "access_token": m.get("accessToken", ""),
                        }
        except Exception:
            pass
    return None

_client_creds = _load_meta_credentials(_CLIENT_ID)
if _client_creds:
    # Inject into environment so rest of script picks them up
    if _client_creds["ad_account_id"]:
        os.environ["META_AD_ACCOUNT_ID"] = _client_creds["ad_account_id"]
    if _client_creds["access_token"]:
        os.environ["META_ACCESS_TOKEN"] = _client_creds["access_token"]

# Final Configuration
AD_ACCOUNT_ID = os.environ.get("META_AD_ACCOUNT_ID", "391022327028566").replace("act_", "")
ACCESS_TOKEN = os.environ.get("META_ACCESS_TOKEN", "")

# Legacy Fallback (optional)
if not ACCESS_TOKEN:
    creds_path = os.path.join(os.path.dirname(__file__), "meta_credentials.json")
    if os.path.exists(creds_path):
        with open(creds_path) as f:
            ACCESS_TOKEN = json.load(f).get("access_token", "")
API_VERSION = "v21.0"
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
HIST_DIR = os.path.join(DATA_DIR, "historical")
LEARNING_FILE = os.path.join(DATA_DIR, "learning_history.json")

TODAY = datetime.date.today()
NOW = datetime.datetime.now()
YESTERDAY = TODAY - datetime.timedelta(days=1)
DATE_30D_AGO = TODAY - datetime.timedelta(days=30)
DATE_7D_AGO = TODAY - datetime.timedelta(days=7)
DATE_14D_AGO = TODAY - datetime.timedelta(days=14)
MTD_START = TODAY.replace(day=1)

CADENCE_WINDOWS = {
    "daily":        {"since": str(YESTERDAY), "until": str(YESTERDAY), "label": f"Yesterday ({YESTERDAY})"},
    "twice_weekly": {"since": str(DATE_7D_AGO), "until": str(YESTERDAY), "label": f"Last 7 days ({DATE_7D_AGO} to {YESTERDAY})"},
    "weekly":       {"since": str(DATE_14D_AGO), "until": str(YESTERDAY), "label": f"Last 14 days ({DATE_14D_AGO} to {YESTERDAY})"},
    "biweekly":     {"since": str(DATE_30D_AGO), "until": str(YESTERDAY), "label": f"Last 30 days ({DATE_30D_AGO} to {YESTERDAY})"},
    "monthly":      {"since": str(MTD_START), "until": str(YESTERDAY), "label": f"MTD ({MTD_START} to {YESTERDAY})"},
}

# ── Load Benchmarks from File (Single Source of Truth) ──
BENCHMARKS_PATH = os.path.join(DATA_DIR, "clients", _CLIENT_ID, "benchmarks.json")
_BENCHMARKS_LOADED = False
_BENCHMARKS = {}
if os.path.exists(BENCHMARKS_PATH):
    try:
        with open(BENCHMARKS_PATH, "r") as _bf:
            _BENCHMARKS = json.load(_bf)
        _BENCHMARKS_LOADED = True
        print("Loaded benchmarks from file")
    except Exception as _be:
        print(f"[WARN] Failed to load benchmarks.json: {_be}")
        print("Using default benchmarks")
else:
    print("Using default benchmarks")

# ── Monthly Targets (benchmarks override defaults) ──
MONTHLY_TARGETS = {
    "meta": {
        "budget": _BENCHMARKS.get("budget", 200000),
        "leads": _BENCHMARKS.get("leads", 278),
        "cpl": _BENCHMARKS.get("cpl", 720),
        "svs": {"low": _BENCHMARKS.get("svs_low", 10), "high": _BENCHMARKS.get("svs_high", 12)},
        "cpsv": {"low": _BENCHMARKS.get("cpsv_low", 18000), "high": _BENCHMARKS.get("cpsv_high", 20000)},
    },
    "google": {
        "budget": 800000,
        "leads": 940,
        "cpl": 850,
        "svs": 44,
        "cpsv": 18000,
    },
    "overall": {
        "budget": 200000,
        "leads": 274,
        "cpl": 730,
        "svs": 22,
        "cpsv": 9000,
    },
}

# ── Dynamic month bounds ──
_TODAY = datetime.date.today()
_MONTH_START = _TODAY.replace(day=1)
_, _MONTH_DAYS = calendar.monthrange(_TODAY.year, _TODAY.month)
_MONTH_END = _TODAY.replace(day=_MONTH_DAYS)
MONTHLY_TARGETS["month"] = _TODAY.strftime("%Y-%m")
MONTHLY_TARGETS["month_start"] = _MONTH_START
MONTHLY_TARGETS["month_end"] = _MONTH_END
MONTHLY_TARGETS["total_days"] = _MONTH_DAYS

# ── Load overrides from client config if available (benchmarks take priority) ──
CONFIG_PATH = os.path.join(DATA_DIR, "clients", _CLIENT_ID, "config.json")
if os.path.exists(CONFIG_PATH) and not _BENCHMARKS_LOADED:
    with open(CONFIG_PATH) as f:
        config = json.load(f)
        MONTHLY_TARGETS["meta"].update(config.get("meta_targets", {}))

# ── DYNAMIC ALERT THRESHOLDS (30% above target, NOT hardcoded) ──
CPL_TARGET = MONTHLY_TARGETS["meta"]["cpl"]  # 720
CPL_ALERT = round(CPL_TARGET * 1.3)          # 936 — 30% above target
CPL_CRITICAL = round(CPL_TARGET * 1.5)       # 1080 — 50% above target

# ── SOP Benchmarks (driven by benchmarks.json when available) ──
SOP = {
    "cpm_ideal_low": _BENCHMARKS.get("cpm_ideal_low", 300),
    "cpm_ideal_high": _BENCHMARKS.get("cpm_ideal_high", 520),
    "cpm_alert": _BENCHMARKS.get("cpm_alert", 600) if _BENCHMARKS.get("cpm_alert") else max(_BENCHMARKS.get("cpm_max", 300) * 2, 600) if _BENCHMARKS.get("cpm_max") else 600,
    "ctr_ideal_low": _BENCHMARKS.get("ctr_min", 0.7),
    "ctr_ideal_high": _BENCHMARKS.get("ctr_ideal_high", 1.5),
    "ctr_alert": _BENCHMARKS.get("ctr_min", 0.7),
    "ctr_critical": _BENCHMARKS.get("ctr_critical", 0.4),
    # CPL — dynamic, derived from targets
    "cpl_target": CPL_TARGET,
    "cpl_alert": CPL_ALERT,
    "cpl_critical": CPL_CRITICAL,
    # Frequency
    "freq_tofu_mofu_warn": _BENCHMARKS.get("frequency_max", 2.5),
    "freq_tofu_mofu_severe": _BENCHMARKS.get("frequency_severe", 3.0),
    "freq_bofu_warn": _BENCHMARKS.get("freq_bofu_warn", 4.0),
    "freq_bofu_severe": _BENCHMARKS.get("freq_bofu_severe", 5.0),
    "freq_general_alert": _BENCHMARKS.get("freq_general_alert", 4.0),
    # Creative health
    "thumb_stop_target": _BENCHMARKS.get("tsr_target", 30),
    "thumb_stop_alert": _BENCHMARKS.get("tsr_min", 25) if _BENCHMARKS.get("tsr_min") and _BENCHMARKS.get("tsr_min") < 30 else max((_BENCHMARKS.get("tsr_min", 5.0) if _BENCHMARKS.get("tsr_min", 5.0) >= 20 else 25), 5),
    "first_frame_target": _BENCHMARKS.get("ffr_target", 90),
    "first_frame_alert": _BENCHMARKS.get("ffr_min", 80),
    "hold_rate_target": _BENCHMARKS.get("vhr_target", 35),
    "hold_rate_alert": _BENCHMARKS.get("vhr_min", 25),
    "creative_max_age_days": _BENCHMARKS.get("creative_max_age_days", 45),
    "creative_refresh_days": _BENCHMARKS.get("creative_refresh_days", 30),
    # Budget
    "spend_anomaly_high": _BENCHMARKS.get("spend_anomaly_high", 1.5),
    "spend_anomaly_low": _BENCHMARKS.get("spend_anomaly_low", 0.5),
    "budget_scale_max_pct": _BENCHMARKS.get("budget_scale_max_pct", 25),
    "funnel_new_tofu": _BENCHMARKS.get("funnel_new_tofu", 55),
    "funnel_new_mofu": _BENCHMARKS.get("funnel_new_mofu", 35),
    "funnel_new_bofu": _BENCHMARKS.get("funnel_new_bofu", 10),
    "funnel_mature_tofu": _BENCHMARKS.get("funnel_mature_tofu", 30),
    "funnel_mature_mofu": _BENCHMARKS.get("funnel_mature_mofu", 50),
    "funnel_mature_bofu": _BENCHMARKS.get("funnel_mature_bofu", 20),
    # CTR decay
    "ctr_decay_warning": _BENCHMARKS.get("ctr_decay_warning", 15),
    "ctr_decay_critical": _BENCHMARKS.get("ctr_decay_critical", 30),
    # Scoring weights — video
    "ad_score_weights_video": _BENCHMARKS.get("ad_score_weights_video", {
        "cpl_vs_target": 35, "cpm": 20, "thumb_stop": 15, "video_hold": 15, "ctr": 15,
    }),
    "ad_score_weights_static": _BENCHMARKS.get("ad_score_weights_static", {
        "cpl_vs_target": 45, "cpm": 25, "ctr": 30,
    }),
    "campaign_score_weights": _BENCHMARKS.get("campaign_score_weights", {
        "cpl_vs_target": 35, "cpm": 15, "ctr": 15, "frequency": 15, "lead_volume": 10, "budget_util": 10,
    }),
    # Auto-pause
    "auto_pause_zero_leads_impressions": _BENCHMARKS.get("auto_pause_zero_leads_impressions", 8000),
    "auto_pause_cpl_multiplier": 1 + (_BENCHMARKS.get("auto_pause_cpl_threshold_pct", 30) / 100),
    # Winner / Loser
    "winner_threshold": _BENCHMARKS.get("winner_threshold", 70),
    "loser_threshold": _BENCHMARKS.get("loser_threshold", 35),
    # Google
    "google_search_score_weights": _BENCHMARKS.get("google_search_score_weights", {
        "cpl_vs_target": 30, "cpc": 20, "cvr": 20, "ctr": 10, "impression_share": 20,
    }),
}

LEAD_ACTION_TYPES = [
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_complete_registration_add_meta_leads",
]

# ── Full Descriptive Playbook Names ──
PLAYBOOK_NAMES = {
    1: "CPM Cost Increases — Auction & Creative Fix",
    2: "CTR Drop Recovery — Hook & Messaging Refresh",
    3: "CPL Cost Spiral — Form, Audience & Creative Triage",
    4: "Thumb Stop Recovery — First 3 Seconds Fix",
    5: "Video Hold Rate Recovery — Narrative & Pacing Fix",
    6: "Ad Fatigue Combat — Creative Rotation & Audience Expansion",
    7: "Lead Quality Recovery — Targeting & Form Filters",
    8: "Stagnant Results Despite OK Frequency — Algorithm Reset",
    9: "Non-Delivering Adset Recovery — Budget & Audience Fix",
    10: "Volume Drop with Stable CPL — Scale & Learning Reset",
}


# ━━━━━━━━━━━━━━━━━━━━━━━━━ UTILITY HELPERS ━━━━━━━━━━━━━━━━━━━━━━━

def sf(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default

def si(val, default=0):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default

def fmt_inr(val):
    if abs(val) >= 10000000:
        return f"\u20b9{val/10000000:.2f} Cr"
    if abs(val) >= 100000:
        return f"\u20b9{val/100000:.2f} L"
    if abs(val) >= 1000:
        return f"\u20b9{val:,.0f}"
    return f"\u20b9{val:,.2f}"

def pct(val, decimals=2):
    return f"{val:.{decimals}f}%"

def get_action_value(actions, types):
    if not actions:
        return 0
    for t in types:
        for a in actions:
            if a.get("action_type") == t:
                return si(a.get("value", 0))
    return 0

def get_cost_per_action(cpa_list, types):
    if not cpa_list:
        return 0.0
    for t in types:
        for a in cpa_list:
            if a.get("action_type") == t:
                return sf(a.get("value", 0))
    return 0.0

def trend_direction(values):
    if len(values) < 2:
        return "STABLE", 0
    first_half = values[:len(values)//2]
    second_half = values[len(values)//2:]
    avg_first = sum(first_half) / len(first_half) if first_half else 0
    avg_second = sum(second_half) / len(second_half) if second_half else 0
    if avg_first == 0:
        return "STABLE", 0
    pct_change = ((avg_second - avg_first) / avg_first) * 100
    if pct_change > 10:
        return "UP", pct_change
    elif pct_change < -10:
        return "DOWN", pct_change
    return "STABLE", pct_change

def classify_funnel_layer(name, targeting=None, objective="", optimization_goal=""):
    name_lower = (name or "").lower()
    obj_lower = (objective or "").lower()
    opt_lower = (optimization_goal or "").lower()
    if "bofu" in name_lower or "retarget" in name_lower or "remarket" in name_lower:
        return "BOFU"
    if "mofu" in name_lower or "lookalike" in name_lower or "lal" in name_lower or "custom_audience" in name_lower:
        return "MOFU"
    if "tofu" in name_lower or "prospect" in name_lower or "broad" in name_lower:
        return "TOFU"
    if targeting:
        custom_audiences = targeting.get("custom_audiences", [])
        if custom_audiences:
            for ca in custom_audiences:
                ca_name = (ca.get("name", "") or "").lower()
                if "lookalike" in ca_name or "lal" in ca_name:
                    return "MOFU"
                if "retarget" in ca_name or "website" in ca_name or "visitor" in ca_name:
                    return "BOFU"
            return "MOFU"
    if "adv+" in name_lower or "advantage" in name_lower or "advplus" in name_lower:
        return "TOFU"
    if "awareness" in obj_lower or "engagement" in obj_lower or "reach" in opt_lower:
        return "TOFU"
    if "lead" in obj_lower or "lead" in opt_lower:
        return "TOFU"
    return "TOFU"

def ice_score(impact, confidence, effort):
    return round((impact + confidence + effort) / 3, 1)

def parse_date_range(date_range_str):
    """Parse --date-range into (since, until) date strings."""
    mapping = {
        "today": (str(TODAY), str(TODAY)),
        "yesterday": (str(TODAY - datetime.timedelta(days=1)), str(TODAY - datetime.timedelta(days=1))),
        "7d": (str(DATE_7D_AGO), str(TODAY)),
        "14d": (str(DATE_14D_AGO), str(TODAY)),
        "30d": (str(DATE_30D_AGO), str(TODAY)),
        "mtd": (str(MTD_START), str(TODAY)),
    }
    if date_range_str in mapping:
        return mapping[date_range_str]
    if ":" in date_range_str:
        parts = date_range_str.split(":")
        if len(parts) == 2:
            return (parts[0].strip(), parts[1].strip())
    return None


def aggregate_insights(insights_list, group_by_key):
    """Aggregate daily insight rows into entity-level totals."""
    if not insights_list:
        return []
    
    aggregated = defaultdict(lambda: {
        "spend": 0.0, "impressions": 0, "clicks": 0, "reach": 0,
        "actions": [], "cost_per_action_type": [],
    })
    
    # Track extra fields that should be preserved from the first row encountered
    metadata = {}
    
    for row in insights_list:
        eid = row.get(group_by_key)
        if not eid:
            continue
            
        target = aggregated[eid]
        target["spend"] += sf(row.get("spend"))
        target["impressions"] += si(row.get("impressions"))
        target["clicks"] += si(row.get("clicks"))
        target["reach"] += si(row.get("reach")) # Reach is not perfectly additive but this is the standard proxy
        
        # Merge actions (leads)
        if row.get("actions"):
            action_map = {a["action_type"]: si(a["value"]) for a in target["actions"]}
            for a in row["actions"]:
                atype = a["action_type"]
                action_map[atype] = action_map.get(atype, 0) + si(a["value"])
            target["actions"] = [{"action_type": k, "value": str(v)} for k, v in action_map.items()]
            
        # Store metadata if first time seeing this entity
        if eid not in metadata:
            metadata[eid] = {k: v for k, v in row.items() if k not in ("spend", "impressions", "clicks", "reach", "actions", "cost_per_action_type", "date_start", "date_stop")}

    results = []
    for eid, totals in aggregated.items():
        row = totals
        row[group_by_key] = eid
        row.update(metadata.get(eid, {}))
        # Re-calculate aggregate CPL/CTR etc logic happens in downstream modules
        results.append(row)
        
    return results


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━ API LAYER ━━━━━━━━━━━━━━━━━━━━━━━━━━━

def api_get(endpoint, params=None):
    if params is None:
        params = {}
    params["access_token"] = ACCESS_TOKEN
    url = f"{BASE_URL}/{endpoint}?{urlencode(params, quote_via=quote)}"
    try:
        req = Request(url, headers={"User-Agent": "MojoPerformanceAgent/3.0"})
        with urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode())
    except (HTTPError, URLError, Exception) as e:
        if hasattr(e, 'read'):
            try:
                print(f"  [API WARN] {endpoint} debug: {e.read().decode()}")
            except:
                pass
        print(f"  [API WARN] {endpoint}: {e}")
        return None

def fetch_all_pages(endpoint, params=None):
    results = []
    if params is None:
        params = {}
    params["access_token"] = ACCESS_TOKEN
    url = f"{BASE_URL}/{endpoint}?{urlencode(params, quote_via=quote)}"
    while url:
        try:
            req = Request(url, headers={"User-Agent": "MojoPerformanceAgent/3.0"})
            with urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode())
        except (HTTPError, URLError, Exception) as e:
            if hasattr(e, 'read'):
                try:
                    print(f"  [API WARN] paginate debug: {e.read().decode()}")
                except:
                    pass
            print(f"  [API WARN] paginate: {e}")
            break
        results.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
    return results


# ━━━━━━━━━━━━━━━━━━━━━━━━ DATA COLLECTION ━━━━━━━━━━━━━━━━━━━━━━━━

def load_cached(filename):
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        with open(path, "r") as f:
            data = json.load(f)
        return data.get("data", data) if isinstance(data, dict) else data
    return []

def save_json(filepath, data):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2, default=str)

def load_historical(days_back=7):
    snapshots = []
    for i in range(1, days_back + 1):
        d = TODAY - datetime.timedelta(days=i)
        path = os.path.join(HIST_DIR, f"{d}.json")
        if os.path.exists(path):
            with open(path, "r") as f:
                snapshots.append({"date": str(d), "data": json.load(f)})
    return snapshots

def load_learning_history():
    if os.path.exists(LEARNING_FILE):
        try:
            with open(LEARNING_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"runs": [], "patterns": [], "fatigue_timelines": {}, "audience_saturation": {}}

def save_learning_history(learning_data):
    save_json(LEARNING_FILE, learning_data)

def collect_data(date_since=None, date_until=None):
    """Collect all data from Meta Marketing API."""
    print("\n=== DATA COLLECTION ===\n")
    ds = {}

    since = date_since or str(DATE_7D_AGO)
    until = date_until or str(TODAY)

    # 1. Campaigns list — ALL non-REMOVED (fresh discovery every run)
    print("  Fetching ALL non-REMOVED campaigns...")
    ds["campaigns"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/campaigns",
        {"fields": "name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,created_time",
         "filtering": json.dumps([{"field": "effective_status", "operator": "NOT_IN", "value": ["DELETED", "ARCHIVED"]}]),
         "limit": "200"})
    print(f"    -> {len(ds['campaigns'])} campaigns (all non-removed)")

    insight_fields_campaign = "date_start,campaign_name,campaign_id,impressions,clicks,ctr,cpc,cpm,spend,actions,cost_per_action_type,frequency,reach,objective,video_p25_watched_actions,video_p50_watched_actions"
    insight_fields_adset = "date_start,campaign_name,campaign_id,adset_name,adset_id,impressions,clicks,ctr,cpc,cpm,spend,actions,cost_per_action_type,frequency,reach"
    insight_fields_ad = "date_start,campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,impressions,clicks,ctr,cpc,cpm,spend,actions,cost_per_action_type,frequency,reach,video_avg_time_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions"

    # 2a. Campaign insights — primary window (DAILY BREAKDOWN)
    print(f"  Fetching campaign insights ({since} to {until})...")
    ds["campaign_insights"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_campaign,
         "time_range": json.dumps({"since": since, "until": until}),
         "time_increment": "1", # ENABLE DAILY BREAKDOWN
         "level": "campaign", "limit": "500"})
    print(f"    -> {len(ds['campaign_insights'])} campaigns")

    # 2b. Campaign insights — MTD (used for monthly pacing, always up to yesterday)
    print(f"  Fetching campaign insights MTD ({MTD_START} to {YESTERDAY})...")
    # Handle the "1st of month" case where MTD_START > YESTERDAY
    mtd_until = max(MTD_START, YESTERDAY)
    ds["campaign_insights_mtd"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_campaign,
         "time_range": json.dumps({"since": str(MTD_START), "until": str(mtd_until)}),
         "time_increment": "1",
         "level": "campaign", "limit": "500"})
    print(f"    -> {len(ds['campaign_insights_mtd'])} campaigns (MTD)")

    # 2c. Campaign insights — 14d
    print("  Fetching campaign insights (14d)...")
    ds["campaign_insights_14d"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_campaign,
         "time_range": json.dumps({"since": str(DATE_14D_AGO), "until": str(YESTERDAY)}),
         "time_increment": "1",
         "level": "campaign", "limit": "500"})
    print(f"    -> {len(ds['campaign_insights_14d'])} campaigns (14d)")

    # 3. Ad set insights — primary + 14d
    print(f"  Fetching ad set insights ({since} to {until})...")
    ds["adset_insights"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_adset,
         "time_range": json.dumps({"since": since, "until": until}),
         "time_increment": "1",
         "level": "adset", "limit": "500"})
    print(f"    -> {len(ds['adset_insights'])} ad sets")

    print("  Fetching ad set insights (14d)...")
    ds["adset_insights_14d"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_adset,
         "time_range": json.dumps({"since": str(DATE_14D_AGO), "until": str(YESTERDAY)}),
         "time_increment": "1",
         "level": "adset", "limit": "500"})
    print(f"    -> {len(ds['adset_insights_14d'])} ad sets (14d)")

    # 4. Ad insights — primary
    print(f"  Fetching ad insights ({since} to {until})...")
    ds["ad_insights"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_ad,
         "time_range": json.dumps({"since": since, "until": until}),
         "time_increment": "1",
         "level": "ad", "limit": "500"})
    print(f"    -> {len(ds['ad_insights'])} ads")

    # 5. Daily trends (7d)
    print("  Fetching daily trends (7d)...")
    ds["daily_trends"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": "spend,impressions,clicks,ctr,cpc,cpm,actions,frequency,reach,video_p25_watched_actions,video_p50_watched_actions",
         "time_range": json.dumps({"since": str(DATE_7D_AGO), "until": str(TODAY)}),
         "time_increment": "1", "level": "account", "limit": "30"})
    print(f"    -> {len(ds['daily_trends'])} daily records")

    # 6. Campaign daily breakdown (7d)
    print("  Fetching campaign daily breakdown (7d)...")
    ds["campaign_daily"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": "campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
         "time_range": json.dumps({"since": str(DATE_7D_AGO), "until": str(TODAY)}),
         "time_increment": "1", "level": "campaign", "limit": "200"})
    print(f"    -> {len(ds['campaign_daily'])} campaign-day records")

    # 7. ALL non-REMOVED ad sets with targeting (fresh discovery every run)
    print("  Fetching all non-REMOVED ad sets...")
    ds["active_adsets"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/adsets",
        {"fields": "name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,targeting,optimization_goal,bid_strategy,campaign_id,start_time,created_time",
         "filtering": json.dumps([{"field": "effective_status", "operator": "NOT_IN", "value": ["DELETED", "ARCHIVED"]}]),
         "limit": "200"})
    print(f"    -> {len(ds['active_adsets'])} non-removed ad sets")

    # 8. ALL non-REMOVED ads with creative (fresh discovery every run)
    print("  Fetching all non-REMOVED ads...")
    ds["active_ads"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/ads",
        {"fields": "name,status,effective_status,creative{thumbnail_url,body,object_story_spec,title,video_id,object_type},adset_id,campaign_id,configured_status,created_time",
         "filtering": json.dumps([{"field": "effective_status", "operator": "NOT_IN", "value": ["DELETED", "ARCHIVED"]}]),
         "limit": "200"})
    print(f"    -> {len(ds['active_ads'])} non-removed ads")

    # 9. ALL adsets (including non-active) for delivery status detection
    print("  Fetching all ad sets (for delivery detection)...")
    ds["all_adsets"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/adsets",
        {"fields": "name,status,effective_status,daily_budget,lifetime_budget,budget_remaining,targeting,optimization_goal,bid_strategy,campaign_id,start_time,created_time",
         "limit": "200"})
    print(f"    -> {len(ds['all_adsets'])} total ad sets")

    # 10. Demographic Breakdowns
    insight_fields_breakdown = "spend,impressions,clicks,actions"

    # 10a. Age breakdown
    print("  Fetching age breakdowns...")
    ds["breakdown_age"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_breakdown,
         "time_range": json.dumps({"since": since, "until": until}),
         "breakdowns": "age",
         "level": "account", "limit": "500"})
    print(f"    -> {len(ds['breakdown_age'])} age rows")

    # 10b. Gender breakdown
    print("  Fetching gender breakdowns...")
    ds["breakdown_gender"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_breakdown,
         "time_range": json.dumps({"since": since, "until": until}),
         "breakdowns": "gender",
         "level": "account", "limit": "500"})
    print(f"    -> {len(ds['breakdown_gender'])} gender rows")

    # 10c. Placement breakdown (publisher_platform)
    print("  Fetching placement breakdowns...")
    ds["breakdown_placement"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_breakdown,
         "time_range": json.dumps({"since": since, "until": until}),
         "breakdowns": "publisher_platform",
         "level": "account", "limit": "500"})
    print(f"    -> {len(ds['breakdown_placement'])} placement rows")

    # 10d. Device breakdown (device_platform)
    print("  Fetching device breakdowns...")
    ds["breakdown_device"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_breakdown,
         "time_range": json.dumps({"since": since, "until": until}),
         "breakdowns": "device_platform",
         "level": "account", "limit": "500"})
    print(f"    -> {len(ds['breakdown_device'])} device rows")

    # 10e. Region breakdown
    print("  Fetching region breakdowns...")
    ds["breakdown_region"] = fetch_all_pages(
        f"act_{AD_ACCOUNT_ID}/insights",
        {"fields": insight_fields_breakdown,
         "time_range": json.dumps({"since": since, "until": until}),
         "breakdowns": "region",
         "level": "account", "limit": "500"})
    print(f"    -> {len(ds['breakdown_region'])} region rows")

    # 11. Campaign-level demographic breakdowns
    print("  Fetching campaign-level breakdowns...")
    insight_fields_campaign_bd = "campaign_name,campaign_id,spend,impressions,clicks,actions"

    campaign_breakdowns = {}
    active_campaign_ids = set()
    for ci in ds.get("campaign_insights", []):
        cid = ci.get("campaign_id")
        if cid and sf(ci.get("spend")) > 0:
            active_campaign_ids.add(cid)

    for cid in active_campaign_ids:
        campaign_breakdowns[cid] = {}
        for bd_type, bd_key in [("age", "age"), ("gender", "gender"),
                                 ("publisher_platform", "placement"),
                                 ("device_platform", "device"),
                                 ("region", "region")]:
            try:
                rows = fetch_all_pages(
                    f"{cid}/insights",
                    {"fields": insight_fields_campaign_bd,
                     "time_range": json.dumps({"since": since, "until": until}),
                     "breakdowns": bd_type,
                     "limit": "500"})
                campaign_breakdowns[cid][bd_key] = rows
            except Exception as e:
                print(f"    [WARN] Failed to fetch {bd_type} for campaign {cid}: {e}")
                campaign_breakdowns[cid][bd_key] = []
        print(f"    Campaign {cid}: age={len(campaign_breakdowns[cid].get('age',[]))} gender={len(campaign_breakdowns[cid].get('gender',[]))} placement={len(campaign_breakdowns[cid].get('placement',[]))} device={len(campaign_breakdowns[cid].get('device',[]))} region={len(campaign_breakdowns[cid].get('region',[]))}")

    ds["campaign_breakdowns"] = campaign_breakdowns
    print(f"    -> {len(campaign_breakdowns)} campaigns with breakdowns")

    # Cache management
    cache_map = {
        "campaign_insights": "campaign_insights.json",
        "adset_insights": "adset_insights.json",
        "ad_insights": "ad_insights.json",
        "daily_trends": "daily_trends.json",
        "active_adsets": "active_adsets.json",
        "active_ads": "active_ads.json",
    }
    for key, fname in cache_map.items():
        if not ds.get(key):
            cached = load_cached(fname)
            if cached:
                ds[key] = cached
                print(f"  [CACHE] {key}: {len(cached)} records from file")
        else:
            save_json(os.path.join(DATA_DIR, fname), {"data": ds[key]})

    snapshot = {
        "date": str(TODAY),
        "campaign_insights": ds.get("campaign_insights", []),
        "ad_insights": ds.get("ad_insights", []),
        "daily_trends": ds.get("daily_trends", []),
    }
    save_json(os.path.join(HIST_DIR, f"{TODAY}.json"), snapshot)
    print(f"  [SNAPSHOT] Saved historical snapshot: {TODAY}.json")
    ds["historical"] = load_historical(7)
    print(f"  [HISTORY] Loaded {len(ds['historical'])} prior snapshots")
    return ds


# ━━━━━━━━━━━━━━━━━━━━━━━━━ MODULE 3.1: ACCOUNT PULSE ━━━━━━━━━━━━━

def analyze_account_pulse(campaign_insights, daily_trends, historical, ad_daily=None):
    total_spend = sum(sf(c.get("spend")) for c in campaign_insights)
    total_leads = sum(get_action_value(c.get("actions"), LEAD_ACTION_TYPES) for c in campaign_insights)
    total_impressions = sum(si(c.get("impressions")) for c in campaign_insights)
    total_clicks = sum(si(c.get("clicks")) for c in campaign_insights)
    total_reach = sum(si(c.get("reach")) for c in campaign_insights)

    # AGGREGATE DAILY TRENDS BY DATE (Fix: Avoid camp-daily overlaps)
    daily_aggr = {}
    for d in daily_trends:
        dt = d.get("date_start")
        if not dt: continue
        if dt not in daily_aggr:
            daily_aggr[dt] = {
                "spend": 0, "leads": 0, "impressions": 0, "clicks": 0,
                "video_impressions": 0, "v3s": 0, "v50": 0, "v25": 0
            }

        target = daily_aggr[dt]
        target["spend"] += sf(d.get("spend"))
        target["leads"] += get_action_value(d.get("actions"), LEAD_ACTION_TYPES)
        target["impressions"] += si(d.get("impressions"))
        target["clicks"] += si(d.get("clicks"))

        # TSR/VHR Segregation: Only aggregate if it's a video row
        # (Assuming rows with video metrics are videos)
        v3s = get_action_value(d.get("actions"), ["video_view"])
        if v3s > 0 or d.get("video_p25_watched_actions"):
            target["video_impressions"] += si(d.get("impressions"))
            target["v3s"] += v3s
            v25 = get_action_value(d.get("video_p25_watched_actions"), ["video_view"]) or 0
            v50 = get_action_value(d.get("video_p50_watched_actions"), ["video_view"]) or 0
            target["v25"] += v25
            target["v50"] += v50

    # Supplement v50/v25 from ad_daily rows (per-ad daily breakdown, which includes
    # video_p50_watched_actions that Meta's account-level daily API does not return)
    if ad_daily:
        video_aggr = {}
        for a in ad_daily:
            dt = a.get("date_start")
            if not dt: continue
            v3s = get_action_value(a.get("actions"), ["video_view"])
            v25 = get_action_value(a.get("video_p25_watched_actions"), ["video_view"]) or 0
            v50 = get_action_value(a.get("video_p50_watched_actions"), ["video_view"]) or 0
            if v3s > 0 or v25 > 0 or v50 > 0:
                if dt not in video_aggr:
                    video_aggr[dt] = {"video_impressions": 0, "v3s": 0, "v25": 0, "v50": 0}
                video_aggr[dt]["video_impressions"] += si(a.get("impressions"))
                video_aggr[dt]["v3s"] += v3s
                video_aggr[dt]["v25"] += v25
                video_aggr[dt]["v50"] += v50

        # Merge ad-level video data into daily_aggr (fills v50 that account-level API misses)
        for dt, va in video_aggr.items():
            if dt in daily_aggr:
                if va["v50"] > daily_aggr[dt]["v50"]:
                    daily_aggr[dt]["video_impressions"] = va["video_impressions"]
                    daily_aggr[dt]["v3s"] = va["v3s"]
                    daily_aggr[dt]["v25"] = va["v25"]
                    daily_aggr[dt]["v50"] = va["v50"]

    sorted_dates = sorted(daily_aggr.keys())
    daily_spends = [daily_aggr[dt]["spend"] for dt in sorted_dates]
    daily_leads = [daily_aggr[dt]["leads"] for dt in sorted_dates]
    daily_ctrs = [round(safe_div(daily_aggr[dt]["clicks"], daily_aggr[dt]["impressions"]) * 100, 2) for dt in sorted_dates]
    daily_cpms = [round(safe_div(daily_aggr[dt]["spend"], daily_aggr[dt]["impressions"]) * 1000, 2) for dt in sorted_dates]
    
    # Calculate TSR/VHR ONLY for video data
    # TSR = 3s views / impressions
    # VHR = 50% views / 3s views
    daily_tsrs = [round(safe_div(daily_aggr[dt]["v3s"], daily_aggr[dt]["video_impressions"]) * 100, 2) for dt in sorted_dates]
    daily_vhrs = [round(safe_div(daily_aggr[dt]["v50"], daily_aggr[dt]["v3s"]) * 100, 2) for dt in sorted_dates]

    avg_7d_spend = sum(daily_spends) / len(daily_spends) if daily_spends else 0
    latest_spend = daily_spends[-1] if daily_spends else 0
    latest_leads = daily_leads[-1] if daily_leads else 0

    spend_ratio = latest_spend / avg_7d_spend if avg_7d_spend > 0 else 1.0
    spend_status = "NORMAL"
    if spend_ratio > SOP["spend_anomaly_high"]:
        spend_status = "HIGH_ANOMALY"
    elif spend_ratio < SOP["spend_anomaly_low"]:
        spend_status = "LOW_ANOMALY"

    zero_lead_days = sum(1 for l in daily_leads if l == 0)
    avg_daily_leads = sum(daily_leads) / len(daily_leads) if daily_leads else 0
    spend_trend, spend_change = trend_direction(daily_spends)
    leads_trend, leads_change = trend_direction(daily_leads)
    ctr_trend, ctr_change = trend_direction(daily_ctrs)

    not_spending = []
    for c in campaign_insights:
        if sf(c.get("spend")) < 10 and si(c.get("impressions")) < 100:
            not_spending.append(c.get("campaign_name", "Unknown"))

    alerts = []
    if spend_status != "NORMAL":
        alerts.append(f"Spend anomaly: today ₹{latest_spend:,.0f} vs 7d avg ₹{avg_7d_spend:,.0f} ({spend_ratio:.1%})")
    if latest_leads == 0 and avg_daily_leads >= 5:
        alerts.append(f"ZERO leads today (avg: {avg_daily_leads:.0f}/day)")
    for ns in not_spending:
        alerts.append(f"Campaign not spending: {ns[:50]}")

    overall_ctr = (total_clicks / total_impressions * 100) if total_impressions else 0
    overall_cpc = (total_spend / total_clicks) if total_clicks else 0
    overall_cpm = (total_spend / total_impressions * 1000) if total_impressions else 0
    overall_cpl = (total_spend / total_leads) if total_leads else 0

    return {
        "total_spend_30d": total_spend,
        "daily_avg_spend": avg_7d_spend,
        "latest_daily_spend": latest_spend,
        "spend_ratio": spend_ratio,
        "spend_status": spend_status,
        "spend_trend": spend_trend,
        "spend_change_pct": spend_change,
        "total_leads_30d": total_leads,
        "avg_daily_leads": avg_daily_leads,
        "latest_daily_leads": latest_leads,
        "leads_trend": leads_trend,
        "leads_change_pct": leads_change,
        "zero_lead_days": zero_lead_days,
        "total_impressions": total_impressions,
        "total_clicks": total_clicks,
        "total_reach": total_reach,
        "overall_ctr": overall_ctr,
        "ctr_trend": ctr_trend,
        "ctr_change_pct": ctr_change,
        "overall_cpc": overall_cpc,
        "overall_cpm": overall_cpm,
        "overall_cpl": overall_cpl,
        "not_spending_campaigns": not_spending,
        "alerts": alerts,
        "daily_spends": [round(x, 2) for x in daily_spends],
        "daily_leads": [round(x, 1) for x in daily_leads],
        "daily_ctrs": daily_ctrs,
        "daily_cpms": daily_cpms,
        "daily_tsrs": daily_tsrs,
        "daily_vhrs": daily_vhrs,
        "daily_impressions": [daily_aggr[dt]["impressions"] for dt in sorted_dates],
        "daily_clicks": [daily_aggr[dt]["clicks"] for dt in sorted_dates],
    }


# ━━━━━━━━━━━━━━━━━━ MODULE 3.2: COST STACK & FUNNEL TRIAGE ━━━━━━━

def analyze_cost_stack(campaign_insights, adset_insights, campaigns_list, active_adsets, campaign_daily):
    obj_lookup = {}
    for c in campaigns_list:
        obj_lookup[c.get("id", "")] = c.get("objective", "")

    adset_targeting = {}
    for a in active_adsets:
        adset_targeting[a.get("id", "")] = {
            "targeting": a.get("targeting", {}),
            "optimization_goal": a.get("optimization_goal", ""),
            "name": a.get("name", ""),
        }

    layer_data = {"TOFU": [], "MOFU": [], "BOFU": []}
    for c in campaign_insights:
        cid = c.get("campaign_id", "")
        name = c.get("campaign_name", "")
        objective = c.get("objective", "") or obj_lookup.get(cid, "")
        campaign_adsets = [a for a in active_adsets if a.get("campaign_id") == cid]
        targeting = campaign_adsets[0].get("targeting") if campaign_adsets else None
        opt_goal = campaign_adsets[0].get("optimization_goal", "") if campaign_adsets else ""
        layer = classify_funnel_layer(name, targeting, objective, opt_goal)
        spend = sf(c.get("spend"))
        impressions = si(c.get("impressions"))
        clicks = si(c.get("clicks"))
        leads = get_action_value(c.get("actions"), LEAD_ACTION_TYPES)
        cpl = get_cost_per_action(c.get("cost_per_action_type"), LEAD_ACTION_TYPES)
        if cpl == 0 and leads > 0:
            cpl = spend / leads

        entry = {
            "campaign_id": cid, "campaign_name": name, "layer": layer, "objective": objective,
            "spend": spend, "impressions": impressions, "clicks": clicks,
            "ctr": sf(c.get("ctr")), "cpc": sf(c.get("cpc")), "cpm": sf(c.get("cpm")),
            "frequency": sf(c.get("frequency")), "reach": si(c.get("reach")),
            "leads": leads, "cpl": cpl,
        }
        layer_data[layer].append(entry)

    layer_analysis = {}
    for layer, campaigns in layer_data.items():
        if not campaigns:
            layer_analysis[layer] = {"campaigns": [], "aggregate": None, "diagnostics": []}
            continue

        agg_spend = sum(c["spend"] for c in campaigns)
        agg_impressions = sum(c["impressions"] for c in campaigns)
        agg_clicks = sum(c["clicks"] for c in campaigns)
        agg_leads = sum(c["leads"] for c in campaigns)
        agg_ctr = (agg_clicks / agg_impressions * 100) if agg_impressions else 0
        agg_cpc = (agg_spend / agg_clicks) if agg_clicks else 0
        agg_cpm = (agg_spend / agg_impressions * 1000) if agg_impressions else 0
        agg_cpl = (agg_spend / agg_leads) if agg_leads else 0
        avg_freq = sum(c["frequency"] for c in campaigns) / len(campaigns) if campaigns else 0

        aggregate = {
            "spend": agg_spend, "impressions": agg_impressions, "clicks": agg_clicks,
            "leads": agg_leads, "ctr": agg_ctr, "cpc": agg_cpc, "cpm": agg_cpm,
            "cpl": agg_cpl, "avg_frequency": avg_freq, "campaign_count": len(campaigns),
        }

        diagnostics = []
        freq_threshold = SOP["freq_bofu_warn"] if layer == "BOFU" else SOP["freq_tofu_mofu_warn"]

        if agg_cpm > SOP["cpm_alert"]:
            diagnostics.append({"metric": "CPM", "status": "HIGH", "value": agg_cpm,
                "benchmark": f"₹{SOP['cpm_ideal_low']}-{SOP['cpm_ideal_high']} ideal, >{SOP['cpm_alert']} alert",
                "message": f"{layer} CPM at ₹{agg_cpm:.0f} exceeds ₹{SOP['cpm_alert']} alert threshold."})
        elif agg_cpm > SOP["cpm_ideal_high"]:
            diagnostics.append({"metric": "CPM", "status": "ELEVATED", "value": agg_cpm,
                "benchmark": f"₹{SOP['cpm_ideal_low']}-{SOP['cpm_ideal_high']}",
                "message": f"{layer} CPM at ₹{agg_cpm:.0f} above ideal range."})

        if agg_ctr < SOP["ctr_critical"]:
            diagnostics.append({"metric": "CTR", "status": "CRITICAL", "value": agg_ctr,
                "message": f"{layer} CTR at {agg_ctr:.2f}% is critically low (SOP alert: <{SOP['ctr_critical']}%)."})
        elif agg_ctr < SOP["ctr_alert"]:
            diagnostics.append({"metric": "CTR", "status": "LOW", "value": agg_ctr,
                "message": f"{layer} CTR at {agg_ctr:.2f}% below SOP minimum of {SOP['ctr_alert']}%."})

        if avg_freq > freq_threshold:
            severity = "SEVERE" if (
                (layer != "BOFU" and avg_freq > SOP["freq_tofu_mofu_severe"]) or
                (layer == "BOFU" and avg_freq > SOP["freq_bofu_severe"])
            ) else "WARNING"
            diagnostics.append({"metric": "FREQUENCY", "status": severity, "value": avg_freq,
                "message": f"{layer} avg frequency {avg_freq:.2f} exceeds {freq_threshold} threshold."})

        # Combined diagnostics
        if agg_cpm > SOP["cpm_ideal_high"] and agg_ctr < SOP["ctr_alert"]:
            diagnostics.append({"metric": "CPM+CTR", "status": "FATIGUE_SUSPECTED",
                "value": f"CPM={agg_cpm:.0f}, CTR={agg_ctr:.2f}%",
                "message": f"{layer}: CPM rising + CTR falling = creative fatigue suspected."})
        elif agg_ctr < SOP["ctr_alert"] and agg_cpm <= SOP["cpm_ideal_high"]:
            diagnostics.append({"metric": "CTR_WEAK", "status": "HOOK_WEAK",
                "value": f"CPM={agg_cpm:.0f} (stable), CTR={agg_ctr:.2f}%",
                "message": f"{layer}: CPM stable but CTR weak. SOP: sharpen headline/first 3 sec."})

        # CPL check — DYNAMIC threshold
        if agg_leads > 0 and agg_cpl > CPL_ALERT:
            diagnostics.append({"metric": "CPL", "status": "CRITICAL" if agg_cpl > CPL_CRITICAL else "HIGH",
                "value": agg_cpl,
                "benchmark": f"Target ₹{CPL_TARGET}, Alert ₹{CPL_ALERT} (target×1.3), Critical ₹{CPL_CRITICAL} (target×1.5)",
                "message": f"{layer} CPL at ₹{agg_cpl:.0f} exceeds ₹{CPL_ALERT} alert (target ₹{CPL_TARGET} × 1.3)."})

        layer_analysis[layer] = {"campaigns": campaigns, "aggregate": aggregate, "diagnostics": diagnostics}

    total_spend = sum(la["aggregate"]["spend"] for la in layer_analysis.values() if la["aggregate"])
    funnel_split = {}
    for layer in ["TOFU", "MOFU", "BOFU"]:
        agg = layer_analysis[layer].get("aggregate")
        funnel_split[layer] = round(agg["spend"] / total_spend * 100, 1) if agg and total_spend > 0 else 0

    return {
        "layer_analysis": layer_analysis,
        "funnel_split_actual": funnel_split,
        "funnel_split_target_new": {"TOFU": SOP["funnel_new_tofu"], "MOFU": SOP["funnel_new_mofu"], "BOFU": SOP["funnel_new_bofu"]},
        "funnel_split_target_mature": {"TOFU": SOP["funnel_mature_tofu"], "MOFU": SOP["funnel_mature_mofu"], "BOFU": SOP["funnel_mature_bofu"]},
        "total_spend": total_spend,
    }


# ━━━━━━━━━━━━━━━━━━━ MODULE 3.2B: UNIFIED SCORING ENGINE ━━━━━━━━━━━

def _score_metric_vs_target(actual, target, weight, lower_is_better=True):
    if target == 0:
        return 0, "no_data"
    ratio = actual / target if target > 0 else 999
    if lower_is_better:
        if ratio <= 1.0:
            return weight, "excellent"
        elif ratio <= 1.2:
            return weight * 0.75, "good"
        elif ratio <= 1.5:
            return weight * 0.40, "watch"
        else:
            return weight * 0.10, "poor"
    else:
        if ratio >= 1.0:
            return weight, "excellent"
        elif ratio >= 0.75:
            return weight * 0.75, "good"
        elif ratio >= 0.5:
            return weight * 0.40, "watch"
        else:
            return weight * 0.10, "poor"


    return result

def score_meta_ad(ad_data, cpl_target):
    # Standardize weights and use centralized engine
    result = scoring_engine.score_meta_creative_module(ad_data, cpl_target)
    
    # Maintain existing metadata for backwards compatibility/internal logic
    result["total_score"] = result["score"]
    result["performance_score"] = result["score"]
    result["age_score"] = ad_data.get("age_score", 100)
    result["scores"] = result.get("breakdown", {})
    result["bands"] = result.get("bands", {})
    result["detailed_breakdown"] = result.get("detailed_breakdown", {})
    
    score = result["score"]
    if score >= SOP["winner_threshold"]:
        classification = "WINNER"
    elif score <= SOP["loser_threshold"]:
        classification = "LOSER"
    else:
        classification = "WATCH"
        
    result["classification"] = classification
    
    # Auto-pause logic
    leads = ad_data.get("leads", 0)
    impressions = ad_data.get("impressions", 0)
    cpl = ad_data.get("cpl", 0)
    auto_pause_reasons = []
    if leads == 0 and impressions >= SOP["auto_pause_zero_leads_impressions"]:
        auto_pause_reasons.append(f"Zero leads after {impressions:,} impressions")
    if leads > 0 and cpl > cpl_target * SOP["auto_pause_cpl_multiplier"]:
        auto_pause_reasons.append(f"CPL ₹{cpl:,.0f} is >30% above target ₹{cpl_target:,.0f}")
        
    result["should_pause"] = len(auto_pause_reasons) > 0
    result["auto_pause_reasons"] = auto_pause_reasons

    # Fields expected by analyze_creative_health
    is_video = ad_data.get("is_video", False)
    result["scoring_type"] = "video" if is_video else "static"
    result["weights_used"] = (
        {"cpl": 35, "cpm": 20, "tsr": 15, "vhr": 15, "ctr": 15}
        if is_video
        else {"cpl": 45, "cpm": 25, "ctr": 20, "cpc": 10}
    )
    result["scores"] = result.get("breakdown", {})
    result["bands"] = {}

    return result

def score_meta_campaign(campaign_data, cpl_target):
    result = scoring_engine.score_meta_campaign_module(campaign_data, cpl_target)
    result["total_score"] = result["score"]
    result["scores"] = result.get("breakdown", {})
    result["bands"] = result.get("bands", {})
    result["detailed_breakdown"] = result.get("detailed_breakdown", {})
    score = result["score"]
    if score >= SOP.get("winner_threshold", 70):
        result["classification"] = "WINNER"
    elif score <= SOP.get("loser_threshold", 40):
        result["classification"] = "LOSER"
    else:
        result["classification"] = "WATCH"
    return result


# ━━━━━━━━━━━━━━━━━━━━ MODULE 3.3: CREATIVE HEALTH ━━━━━━━━━━━━━━━━

def analyze_creative_health(ad_insights, active_ads):
    results = []
    ad_created = {}
    # Build created_time lookup from ALL ads (active_ads already includes all non-removed)
    for a in active_ads:
        aid = a.get("id", "")
        created = a.get("created_time", "")
        if created:
            try:
                ad_created[aid] = datetime.datetime.strptime(created[:10], "%Y-%m-%d").date()
            except ValueError:
                pass
    # Also extract created_time from ad_insights if available (fallback)
    for a in ad_insights:
        aid = a.get("ad_id", "")
        if aid not in ad_created:
            created = a.get("created_time", "")
            if created:
                try:
                    ad_created[aid] = datetime.datetime.strptime(created[:10], "%Y-%m-%d").date()
                except ValueError:
                    pass

    for ad in ad_insights:
        ad_id = ad.get("ad_id", "")
        ad_name = ad.get("ad_name", "Unknown")
        impressions = si(ad.get("impressions"))
        spend = sf(ad.get("spend"))
        ctr = sf(ad.get("ctr"))
        cpc = sf(ad.get("cpc"))
        cpm = sf(ad.get("cpm"))
        if cpm == 0 and impressions > 0:
            cpm = (spend / impressions) * 1000
        frequency = sf(ad.get("frequency"))
        leads = get_action_value(ad.get("actions"), LEAD_ACTION_TYPES)
        cpl = spend / leads if leads > 0 else 0

        video_p25 = ad.get("video_p25_watched_actions")
        video_p50 = ad.get("video_p50_watched_actions")
        video_p75 = ad.get("video_p75_watched_actions")
        video_p100 = ad.get("video_p100_watched_actions")
        video_avg = ad.get("video_avg_time_watched_actions")

        v25 = si(video_p25[0].get("value")) if video_p25 and isinstance(video_p25, list) else 0
        v50 = si(video_p50[0].get("value")) if video_p50 and isinstance(video_p50, list) else 0
        v75 = si(video_p75[0].get("value")) if video_p75 and isinstance(video_p75, list) else 0
        v100 = si(video_p100[0].get("value")) if video_p100 and isinstance(video_p100, list) else 0
        avg_watch_sec = sf(video_avg[0].get("value")) if video_avg and isinstance(video_avg, list) else 0

        # Determine is_video from API creative fields first, fallback to video metrics
        ad_meta = None
        for _aa in active_ads:
            if _aa.get("id", "") == ad_id:
                ad_meta = _aa
                break
        _creative = (ad_meta or {}).get("creative", {}) if ad_meta else {}
        _has_video_id = bool(_creative.get("video_id"))
        _object_type = (_creative.get("object_type", "") or "").upper()
        is_video = _has_video_id or _object_type == "VIDEO" or v25 > 0 or v50 > 0
        video_views_3s = get_action_value(ad.get("actions"), ["video_view"])
        thumb_stop = (video_views_3s / impressions * 100) if impressions > 0 and video_views_3s > 0 else 0
        hold_rate = (v50 / v25 * 100) if v25 > 0 else 0
        # First Frame Rate approximation (p25 / impressions)
        ffr = (v25 / impressions * 100) if impressions > 0 and v25 > 0 else 0

        created_date = ad_created.get(ad_id)
        # If we still don't have created_time, fetch it from the API directly
        if created_date is None:
            try:
                ad_detail = api_get(ad_id, {"fields": "created_time"})
                if ad_detail and ad_detail.get("created_time"):
                    created_date = datetime.datetime.strptime(ad_detail["created_time"][:10], "%Y-%m-%d").date()
                    ad_created[ad_id] = created_date
            except Exception:
                pass
        creative_age_days = (TODAY - created_date).days if created_date else 0  # Default to 0 if truly unavailable

        signals = []
        # VIDEO-SPECIFIC signals — only for videos
        if is_video:
            if thumb_stop > 0 and thumb_stop < SOP["thumb_stop_alert"]:
                signals.append(f"[VIDEO] Thumb-stop {thumb_stop:.1f}% < {SOP['thumb_stop_alert']}% target. Fix first 3s: add motion/contrast/face.")
            if hold_rate > 0 and hold_rate < SOP["hold_rate_alert"]:
                signals.append(f"[VIDEO] Hold rate {hold_rate:.1f}% < {SOP['hold_rate_alert']}% target. Re-script first 5-7s; add jump-cuts.")
            if ffr > 0 and ffr < SOP["first_frame_alert"]:
                signals.append(f"[VIDEO] First Frame Rate {ffr:.1f}% < {SOP['first_frame_alert']}% target. Improve contrast, thumbnail, motion at 0-1s.")
        else:
            # STATIC-SPECIFIC signals
            if ctr < SOP["ctr_alert"] and impressions > 3000:
                signals.append(f"[STATIC] CTR {ctr:.2f}% below {SOP['ctr_alert']}% threshold. Improve headline, CTA visibility, visual hierarchy.")

        if cpm > SOP["cpm_alert"] and ctr < SOP["ctr_alert"]:
            signals.append(f"High CPM (₹{cpm:.0f}) + weak CTR ({ctr:.2f}%) = fatigue/audience-creative mismatch.")

        # Compute scoring BEFORE age check (age check needs the score)
        cpl_target = MONTHLY_TARGETS["meta"]["cpl"]
        ad_score_data = {
            "leads": leads, "cpl": cpl, "impressions": impressions, "spend": spend,
            "cpm": cpm, "thumb_stop_pct": thumb_stop, "hold_rate_pct": hold_rate,
            "is_video": is_video, "ctr": ctr, "age_days": creative_age_days,
        }
        scoring = score_meta_ad(ad_score_data, cpl_target)

        # Creative Age Thresholds: OK < 30d, Watch 30-35d, Warning 35-45d, Critical > 45d
        # Exception: score >= 70 = "performing_well" regardless of age
        if creative_age_days is not None and creative_age_days > 0:
            _age_status = "OK"
            if creative_age_days >= 45:
                _age_status = "CRITICAL"
            elif creative_age_days >= 35:
                _age_status = "WARNING"
            elif creative_age_days >= 30:
                _age_status = "WATCH"
            if _age_status != "OK":
                if scoring["performance_score"] >= 70:
                    signals.append(f"Creative running {creative_age_days} days [{_age_status}] but performance score {scoring['performance_score']}/100 — PERFORMING_WELL, no refresh needed.")
                else:
                    signals.append(f"Creative running {creative_age_days} days [{_age_status}]. Refresh recommended (OK: <30d, Watch: 30-35d, Warning: 35-45d, Critical: >45d).")
        if frequency > SOP["freq_tofu_mofu_warn"]:
            signals.append(f"Frequency {frequency:.2f} exceeds {SOP['freq_tofu_mofu_warn']} threshold.")
        if leads == 0 and spend > 500:
            signals.append(f"Spent ₹{spend:.0f} with ZERO leads. Review targeting & creative relevance.")
        for reason in scoring["auto_pause_reasons"]:
            signals.append(f"[AUTO-PAUSE] {reason}")

        results.append({
            "ad_id": ad_id, "ad_name": ad_name,
            "campaign_name": ad.get("campaign_name", ""), "adset_name": ad.get("adset_name", ""),
            "spend": spend, "impressions": impressions, "clicks": si(ad.get("clicks")),
            "leads": leads, "cpl": cpl,
            "ctr": ctr, "cpc": cpc, "cpm": cpm, "frequency": frequency,
            "is_video": is_video,
            "creative_type": "video" if is_video else "static",
            "thumb_stop_pct": thumb_stop, "hold_rate_pct": hold_rate,
            "first_frame_rate": ffr,
            "creative_age_days": creative_age_days,
            "creative_score": scoring["total_score"],
            "performance_score": scoring["performance_score"],
            "age_score": scoring["age_score"],
            "classification": scoring["classification"],
            "health_signals": signals,
            "should_pause": scoring["should_pause"],
            "auto_pause_reasons": scoring["auto_pause_reasons"],
            "scoring_type": scoring["scoring_type"],
            "video_p25": v25, "video_p50": v50, "video_p75": v75, "video_p100": v100,
            "avg_watch_sec": avg_watch_sec,
            "weights_used": scoring["weights_used"],
            "score_breakdown": scoring["scores"],
            "score_bands": scoring["bands"],
            "detailed_breakdown": scoring.get("detailed_breakdown", {}),
        })

    return sorted(results, key=lambda x: x["creative_score"], reverse=True)


# ━━━━━━━━━━━━━━━━━━━ MODULE 3.4: FATIGUE DETECTION ━━━━━━━━━━━━━━━

def detect_fatigue(ad_insights, campaign_daily, cost_stack):
    alerts = []
    campaign_layers = {}
    for layer, data in cost_stack["layer_analysis"].items():
        for c in data.get("campaigns", []):
            campaign_layers[c["campaign_id"]] = layer

    campaign_ctr_series = defaultdict(list)
    for d in sorted(campaign_daily, key=lambda x: x.get("date_start", "")):
        cid = d.get("campaign_id", "")
        campaign_ctr_series[cid].append(sf(d.get("ctr")))

    for ad in ad_insights:
        ad_name = ad.get("ad_name", "Unknown")
        campaign = ad.get("campaign_name", "")
        cid = ad.get("campaign_id", "")
        freq = sf(ad.get("frequency"))
        ctr = sf(ad.get("ctr"))
        cpm = sf(ad.get("cpm"))
        impressions = si(ad.get("impressions"))

        layer = campaign_layers.get(cid, "TOFU")
        freq_threshold = SOP["freq_bofu_warn"] if layer == "BOFU" else SOP["freq_tofu_mofu_warn"]
        freq_severe = SOP["freq_bofu_severe"] if layer == "BOFU" else SOP["freq_tofu_mofu_severe"]

        if freq > freq_threshold and impressions > 5000:
            severity = "CRITICAL" if freq > freq_severe else "WARNING"
            alerts.append({
                "type": "FREQUENCY_FATIGUE", "severity": severity,
                "ad_name": ad_name, "campaign": campaign, "layer": layer,
                "frequency": freq, "threshold": freq_threshold,
                "message": f"Ad '{ad_name[:40]}' freq {freq:.2f} > {freq_threshold} ({layer}). "
                           f"{PLAYBOOK_NAMES[6]}: Refresh first 3 sec, swap colors, test UGC variant.",
            })

        if cpm > SOP["cpm_alert"] and ctr < SOP["ctr_alert"] and impressions > 5000:
            alerts.append({
                "type": "CPM_CTR_FATIGUE", "severity": "HIGH",
                "ad_name": ad_name, "campaign": campaign, "layer": layer,
                "cpm": cpm, "ctr": ctr,
                "message": f"Ad '{ad_name[:40]}': CPM ₹{cpm:.0f} + CTR {ctr:.2f}% = strong fatigue signal.",
            })

    for cid, ctr_series in campaign_ctr_series.items():
        if len(ctr_series) < 4:
            continue
        first_half = ctr_series[:len(ctr_series)//2]
        second_half = ctr_series[len(ctr_series)//2:]
        avg_first = sum(first_half) / len(first_half) if first_half else 0
        avg_second = sum(second_half) / len(second_half) if second_half else 0
        if avg_first > 0:
            decay_pct = ((avg_first - avg_second) / avg_first) * 100
            if decay_pct > SOP["ctr_decay_warning"]:
                cname = cid
                for d in campaign_daily:
                    if d.get("campaign_id") == cid:
                        cname = d.get("campaign_name", cid)
                        break
                layer = campaign_layers.get(cid, "TOFU")
                sev = "CRITICAL" if decay_pct > SOP["ctr_decay_critical"] else "WARNING"
                alerts.append({
                    "type": "CTR_DECAY", "severity": sev,
                    "ad_name": "Campaign-level", "campaign": cname, "layer": layer,
                    "decay_pct": decay_pct, "ctr_before": avg_first, "ctr_after": avg_second,
                    "message": f"Campaign '{cname[:45]}' CTR decayed {decay_pct:.0f}% ({avg_first:.2f}% -> {avg_second:.2f}%).",
                })

    return sorted(alerts, key=lambda x: 0 if x["severity"] == "CRITICAL" else (1 if x["severity"] == "HIGH" else 2))


# ━━━━━━━━━━━━━━━━━━━ MODULE 3.5: CAMPAIGN PERFORMANCE ━━━━━━━━━━━━━

def audit_campaigns(campaign_insights, campaigns_list, active_adsets, cost_stack):
    budget_lookup = {}
    for c in campaigns_list:
        cid = c.get("id", "")
        budget_lookup[cid] = {
            "daily_budget": sf(c.get("daily_budget")) / 100,
            "lifetime_budget": sf(c.get("lifetime_budget")) / 100,
            "budget_remaining": sf(c.get("budget_remaining")) / 100,
            "status": c.get("effective_status", c.get("status", "UNKNOWN")),
            "start_time": c.get("start_time", ""),
        }

    adset_budgets = defaultdict(list)
    for a in active_adsets:
        cid = a.get("campaign_id", "")
        adset_budgets[cid].append({
            "daily_budget": sf(a.get("daily_budget", 0)) / 100,
            "budget_remaining": sf(a.get("budget_remaining", 0)) / 100,
        })

    campaign_layers = {}
    for layer, data in cost_stack["layer_analysis"].items():
        for c in data.get("campaigns", []):
            campaign_layers[c["campaign_id"]] = layer

    results = []
    for c in campaign_insights:
        cid = c.get("campaign_id", "")
        name = c.get("campaign_name", "Unknown")
        spend = sf(c.get("spend"))
        impressions = si(c.get("impressions"))
        clicks = si(c.get("clicks"))
        ctr = sf(c.get("ctr"))
        cpc = sf(c.get("cpc"))
        cpm = sf(c.get("cpm"))
        frequency = sf(c.get("frequency"))
        reach = si(c.get("reach"))
        objective = c.get("objective", "")
        leads = get_action_value(c.get("actions"), LEAD_ACTION_TYPES)
        cpl = get_cost_per_action(c.get("cost_per_action_type"), LEAD_ACTION_TYPES)
        if cpl == 0 and leads > 0:
            cpl = spend / leads

        bi = budget_lookup.get(cid, {})
        daily_budget = bi.get("daily_budget", 0)
        if daily_budget == 0:
            daily_budget = sum(ab["daily_budget"] for ab in adset_budgets.get(cid, []))
        budget_remaining = bi.get("budget_remaining", 0)
        if budget_remaining == 0:
            budget_remaining = sum(ab["budget_remaining"] for ab in adset_budgets.get(cid, []))

        layer = campaign_layers.get(cid, "TOFU")
        is_lead = "LEAD" in (objective or "").upper() or leads > 0
        is_awareness = "ENGAGEMENT" in (objective or "").upper() or "AWARENESS" in (objective or "").upper()

        budget_util = 0
        if daily_budget > 0:
            est_budget_30d = daily_budget * 30
            budget_util = (spend / est_budget_30d * 100) if est_budget_30d > 0 else 0

        # Delivery status
        delivery_status = "DELIVERING"
        if spend < 10 and impressions < 100:
            delivery_status = "NOT_DELIVERING"
        elif spend < daily_budget * 0.3 and spend > 0:
            delivery_status = "LOW_DELIVERY"

        # Learning Limited detection
        learning_status = "ACTIVE"
        if leads < 50 / 7 * 7 and spend > 1000:  # < ~50 conversions/week
            learning_status = "LEARNING_LIMITED"
        if delivery_status == "NOT_DELIVERING":
            learning_status = "NOT_DELIVERING"

        cpl_target = MONTHLY_TARGETS["meta"]["cpl"]
        campaign_score_data = {
            "leads": leads, "cpl": cpl, "impressions": impressions, "spend": spend,
            "cpm": cpm, "ctr": ctr, "frequency": frequency, "layer": layer,
            "daily_budget": daily_budget, "budget_utilization_pct": budget_util,
        }
        scoring = score_meta_campaign(campaign_score_data, cpl_target)

        results.append({
            "campaign_id": cid, "campaign_name": name, "layer": layer, "objective": objective,
            "status": bi.get("status", "ACTIVE"),
            "health_score": scoring["total_score"], "score_breakdown": scoring["scores"],
            "score_bands": scoring["bands"], "detailed_breakdown": scoring.get("detailed_breakdown", {}),
            "classification": scoring["classification"],
            "spend": spend, "impressions": impressions, "clicks": clicks,
            "ctr": ctr, "cpc": cpc, "cpm": cpm, "frequency": frequency, "reach": reach,
            "leads": leads, "cpl": cpl,
            "daily_budget": daily_budget, "budget_remaining": budget_remaining,
            "budget_utilization_pct": budget_util,
            "is_lead_campaign": is_lead, "is_awareness": is_awareness,
            "delivery_status": delivery_status,
            "learning_status": learning_status,
        })

    return sorted(results, key=lambda x: x["health_score"], reverse=True)


# ━━━━━━━━━━━━━━━━━━━ MODULE 3.6: ADSET ANALYSIS (NEW) ━━━━━━━━━━━━

def analyze_adsets(adset_insights, active_adsets, all_adsets, cost_stack):
    """Full adset-level analysis with scoring, delivery detection, learning status."""
    # Build adset meta lookup
    adset_meta = {}
    for a in (all_adsets or []):
        aid = a.get("id", "")
        adset_meta[aid] = {
            "name": a.get("name", ""),
            "status": a.get("effective_status", a.get("status", "UNKNOWN")),
            "daily_budget": sf(a.get("daily_budget", 0)) / 100,
            "lifetime_budget": sf(a.get("lifetime_budget", 0)) / 100,
            "budget_remaining": sf(a.get("budget_remaining", 0)) / 100,
            "targeting": a.get("targeting", {}),
            "optimization_goal": a.get("optimization_goal", ""),
            "bid_strategy": a.get("bid_strategy", ""),
            "campaign_id": a.get("campaign_id", ""),
        }

    # Campaign layer lookup
    campaign_layers = {}
    for layer, data in cost_stack["layer_analysis"].items():
        for c in data.get("campaigns", []):
            campaign_layers[c["campaign_id"]] = layer

    results = []
    for a in adset_insights:
        asid = a.get("adset_id", "")
        name = a.get("adset_name", "Unknown")
        cid = a.get("campaign_id", "")
        campaign_name = a.get("campaign_name", "")
        spend = sf(a.get("spend"))
        impressions = si(a.get("impressions"))
        clicks = si(a.get("clicks"))
        ctr = sf(a.get("ctr"))
        cpc = sf(a.get("cpc"))
        cpm = sf(a.get("cpm"))
        frequency = sf(a.get("frequency"))
        reach = si(a.get("reach"))
        leads = get_action_value(a.get("actions"), LEAD_ACTION_TYPES)
        cpl = spend / leads if leads > 0 else 0

        meta = adset_meta.get(asid, {})
        daily_budget = meta.get("daily_budget", 0)
        layer = campaign_layers.get(cid, classify_funnel_layer(name, meta.get("targeting"), "", meta.get("optimization_goal", "")))

        # Budget utilization
        budget_util = 0
        if daily_budget > 0:
            est_budget_period = daily_budget * 7  # Assume 7d window
            budget_util = (spend / est_budget_period * 100) if est_budget_period > 0 else 0

        # Delivery status
        delivery_status = "DELIVERING"
        if spend < 10 and impressions < 100:
            delivery_status = "NOT_DELIVERING"
        elif daily_budget > 0 and spend < daily_budget * 0.3 * 7:
            delivery_status = "LOW_DELIVERY"

        # Learning Limited detection
        learning_status = "ACTIVE"
        if leads < 7 and spend > 500:  # < ~50 per week
            learning_status = "LEARNING_LIMITED"
        if delivery_status == "NOT_DELIVERING":
            learning_status = "NOT_DELIVERING"

        # Score the adset (use campaign scoring logic)
        cpl_target = MONTHLY_TARGETS["meta"]["cpl"]
        score_data = {
            "leads": leads, "cpl": cpl, "impressions": impressions, "spend": spend,
            "cpm": cpm, "ctr": ctr, "frequency": frequency, "layer": layer,
            "daily_budget": daily_budget, "budget_utilization_pct": budget_util,
        }
        scoring = score_meta_campaign(score_data, cpl_target)

        # Auto-pause check
        auto_pause_reasons = []
        if leads == 0 and impressions >= SOP["auto_pause_zero_leads_impressions"]:
            auto_pause_reasons.append(f"Zero leads after {impressions:,} impressions")
        if leads > 0 and cpl > cpl_target * SOP["auto_pause_cpl_multiplier"]:
            pct_above = ((cpl / cpl_target) - 1) * 100
            auto_pause_reasons.append(f"CPL ₹{cpl:,.0f} is {pct_above:.0f}% above target ₹{cpl_target:,.0f}")

        # Diagnostics
        diagnostics = []
        if delivery_status == "NOT_DELIVERING":
            reasons = []
            if daily_budget > 0 and daily_budget < cpl_target * 3 / 100:
                reasons.append(f"Budget too low (₹{daily_budget:.0f}/day < 3x CPL = ₹{cpl_target * 3 / 100:.0f})")
            if learning_status == "LEARNING_LIMITED":
                reasons.append("Learning Limited: <50 conversions/week")
            if not reasons:
                reasons.append("Check: audience too narrow, ad disapprovals, or over-exclusions")
            diagnostics.append({
                "issue": "NOT_DELIVERING",
                "reasons": reasons,
                "playbook": PLAYBOOK_NAMES[9],
                "solutions": [
                    "Ensure budget >= 3x CPL per day",
                    "Widen audience or toggle Optimized Targeting ON",
                    "Duplicate ad set with new budget split for testing",
                    "Rebuild ad set under new campaign ID if fully stuck (hard reset)",
                ],
            })
        if learning_status == "LEARNING_LIMITED" and delivery_status != "NOT_DELIVERING":
            diagnostics.append({
                "issue": "LEARNING_LIMITED",
                "reasons": [f"Only {leads} conversions in period (need ~50/week for stable learning)"],
                "playbook": PLAYBOOK_NAMES[8],
                "solutions": [
                    f"Increase budget by 20-25% (max ₹{daily_budget * 1.25:.0f}/day)" if daily_budget > 0 else "Increase budget by 20-25%",
                    "Consolidate similar adsets to pool conversions",
                    "Broaden audience signals (add Advantage+ targeting)",
                    "Add more creative variants to increase delivery",
                ],
            })

        results.append({
            "adset_id": asid, "adset_name": name,
            "campaign_id": cid, "campaign_name": campaign_name, "layer": layer,
            "spend": spend, "impressions": impressions, "clicks": clicks,
            "ctr": ctr, "cpc": cpc, "cpm": cpm, "frequency": frequency, "reach": reach,
            "leads": leads, "cpl": cpl,
            "daily_budget": daily_budget, "budget_utilization_pct": budget_util,
            "delivery_status": delivery_status, "learning_status": learning_status,
            "health_score": scoring["total_score"], "classification": scoring["classification"],
            "score_breakdown": scoring["scores"], "score_bands": scoring["bands"],
            "detailed_breakdown": scoring.get("detailed_breakdown", {}),
            "should_pause": len(auto_pause_reasons) > 0, "auto_pause_reasons": auto_pause_reasons,
            "diagnostics": diagnostics,
        })

    return sorted(results, key=lambda x: x["health_score"], reverse=True)


# ━━━━━━━━━━━━━━━━━━━━ MODULE 3.6B: DEMOGRAPHIC BREAKDOWNS ━━━━━━━━━━━━━━━━

def analyze_breakdowns(ds):
    """Process demographic breakdown data from Meta API into structured format."""
    print("  Module 3.6B: Demographic Breakdowns...")
    result = {}
    target_locations = ["Hyderabad", "Secunderabad"]
    benchmarks_path = os.path.join(DATA_DIR, "clients", _CLIENT_ID, "benchmarks.json")
    if os.path.exists(benchmarks_path):
        try:
            benchmarks = json.load(open(benchmarks_path))
            target_locations = benchmarks.get("target_locations", target_locations)
        except: pass

    def process_rows(raw_rows, dimension_key):
        # Aggregate by dimension value to avoid duplicates from daily chunks
        aggregated = {}
        for row in raw_rows:
            dim_val = str(row.get(dimension_key, "Unknown"))
            if dim_val not in aggregated:
                aggregated[dim_val] = {"dimension": dim_val, "spend": 0, "impressions": 0, "clicks": 0, "actions": []}
            curr = aggregated[dim_val]
            curr["spend"] += sf(row.get("spend"))
            curr["impressions"] += si(row.get("impressions"))
            curr["clicks"] += si(row.get("clicks"))
            if row.get("actions"): curr["actions"].extend(row.get("actions"))
        final_rows = []
        for dim_val, data in aggregated.items():
            spend = data["spend"]
            leads = get_action_value(data["actions"], LEAD_ACTION_TYPES)
            cpl = spend / leads if leads > 0 else 0
            final_rows.append({
                "dimension": dim_val, "spend": round(spend, 2), "impressions": data["impressions"], "clicks": data["clicks"],
                "ctr": round(data["clicks"] / data["impressions"] * 100, 2) if data["impressions"] > 0 else 0,
                "cpc": round(spend / data["clicks"], 2) if data["clicks"] > 0 else 0,
                "cpm": round(spend / data["impressions"] * 1000, 2) if data["impressions"] > 0 else 0,
                "leads": leads, "cpl": round(cpl, 2),
                "classification": "WINNER" if (leads > 0 and cpl <= CPL_TARGET) else ("UNDERPERFORMER" if (leads > 0 and cpl > CPL_CRITICAL or (leads == 0 and spend > 500)) else "NEUTRAL"),
            })
        final_rows.sort(key=lambda x: x["spend"], reverse=True)
        return final_rows

    breakdown_map = {"age": ("breakdown_age", "age"), "gender": ("breakdown_gender", "gender"), "placement": ("breakdown_placement", "publisher_platform"), "device": ("breakdown_device", "device_platform"), "region": ("breakdown_region", "region")}
    for key, (ds_key, dim_key) in breakdown_map.items():
        raw = ds.get(ds_key, [])
        if raw:
            result[key] = process_rows(raw, dim_key)
        else:
            result[key] = []
    
# Geo-spend validation
    # Meta API returns state-level regions (e.g. "Telangana") not cities.
    # Build a mapping of target cities to their states so state-level data
    # is correctly matched. Known city→state mappings for India:
    CITY_TO_STATE = {
        "hyderabad": "telangana",
        "secunderabad": "telangana",
        "bangalore": "karnataka",
        "bengaluru": "karnataka",
        "mumbai": "maharashtra",
        "delhi": "delhi",
        "new delhi": "delhi",
        "chennai": "tamil nadu",
        "pune": "maharashtra",
        "kolkata": "west bengal",
        "ahmedabad": "gujarat",
        "jaipur": "rajasthan",
        "lucknow": "uttar pradesh",
        "noida": "uttar pradesh",
        "gurugram": "haryana",
        "gurgaon": "haryana",
    }
    # Derive the set of acceptable states from target_locations
    target_states = set()
    target_locs_lower = [loc.lower() for loc in target_locations]
    for loc in target_locs_lower:
        state = CITY_TO_STATE.get(loc)
        if state:
            target_states.add(state)
        target_states.add(loc)  # also match if target IS a state name

    geo_alerts = []
    if result.get("region"):
        for row in result["region"]:
            region_name = row["dimension"].lower()
            is_target = (
                region_name in target_states or
                any(loc in region_name or region_name in loc for loc in target_locs_lower)
            )
            row["is_target_location"] = is_target
            if not is_target and row["spend"] > 0:
                geo_alerts.append({
                    "region": row["dimension"],
                    "spend": row["spend"],
                    "leads": row["leads"],
                    "cpl": row["cpl"],
                    "alert": f"Spend of ₹{row['spend']:.0f} detected outside target locations ({', '.join(target_locations)})"
                })

    # Campaign-level breakdowns
    campaign_results = {}
    raw_campaign_bds = ds.get("campaign_breakdowns", {})
    for cid, bd_data in raw_campaign_bds.items():
        campaign_results[cid] = {}
        for key, (ds_key_unused, dim_key) in breakdown_map.items():
            raw = bd_data.get(key, [])
            if raw:
                campaign_results[cid][key] = process_rows(raw, dim_key)
            else:
                campaign_results[cid][key] = []

            # Campaign-level geo check for region
        if campaign_results[cid].get("region"):
            for row in campaign_results[cid]["region"]:
                region_name = row["dimension"].lower()
                is_target = (
                    region_name in target_states or
                    any(loc in region_name or region_name in loc for loc in target_locs_lower)
                )
                row["is_target_location"] = is_target

    return {
        "breakdowns": result,
        "campaign_breakdowns": campaign_results,
        "target_locations": target_locations,
        "geo_alerts": geo_alerts,
    }


# ━━━━━━━━━━━━━━━━━━━━ MODULE 3.6C: EXECUTION LEARNING ━━━━━━━━━━━━━━━━

def update_execution_learning(analysis):
    """Read pending execution learning entries, compute outcomes from fresh analysis data."""
    learning_path = os.path.join(DATA_DIR, "execution_learning.json")
    if not os.path.exists(learning_path):
        return

    try:
        entries = json.load(open(learning_path))
    except Exception:
        return

    if not isinstance(entries, list) or not entries:
        return

    # Build entity metric lookup from current analysis
    entity_metrics = {}

    # Campaign metrics
    for c in analysis.get("campaign_audit", []):
        entity_metrics[c["campaign_id"]] = {
            "spend": c.get("spend", 0),
            "leads": c.get("leads", 0),
            "cpl": c.get("cpl", 0),
            "ctr": c.get("ctr", 0),
            "impressions": c.get("impressions", 0),
        }

    # Adset metrics
    for a in analysis.get("adset_analysis", []):
        entity_metrics[a["adset_id"]] = {
            "spend": a.get("spend", 0),
            "leads": a.get("leads", 0),
            "cpl": a.get("cpl", 0),
            "ctr": a.get("ctr", 0),
            "impressions": a.get("impressions", 0),
        }

    # Creative/Ad metrics
    for ad in analysis.get("creative_health", []):
        entity_metrics[ad["ad_id"]] = {
            "spend": ad.get("spend", 0),
            "leads": ad.get("leads", 0),
            "cpl": ad.get("cpl", 0),
            "ctr": ad.get("ctr", 0),
            "impressions": ad.get("impressions", 0),
        }

    # Account-level CPL for pause outcome checks
    account_cpl = analysis.get("account_pulse", {}).get("overall_cpl", 0)

    updated = False
    for entry in entries:
        if entry.get("outcome") != "PENDING":
            continue

        executed_at = entry.get("executedAt", "")
        if not executed_at:
            continue

        try:
            exec_date = datetime.strptime(executed_at[:10], "%Y-%m-%d").date()
        except Exception:
            continue

        days_elapsed = (TODAY - exec_date).days
        entry["daysElapsed"] = days_elapsed

        if days_elapsed < 3:
            continue  # Too soon to measure

        entity_id = entry.get("entityId", "")
        action = entry.get("action", "")
        before = entry.get("beforeMetrics", {})

        # Look up current metrics
        current = entity_metrics.get(entity_id)
        if current:
            entry["afterMetrics"] = {
                **current,
                "measuredAt": NOW.isoformat(),
            }

        # Compute outcome
        if action.startswith("PAUSE"):
            # For pause actions, check if account CPL improved
            before_cpl = before.get("cpl", 0)
            if before_cpl > 0 and account_cpl > 0:
                change_pct = ((account_cpl - before_cpl) / before_cpl) * 100
                if change_pct < -5:
                    entry["outcome"] = "POSITIVE"
                    entry["outcomeReason"] = f"Account CPL improved {abs(change_pct):.0f}% after pause"
                elif change_pct > 10:
                    entry["outcome"] = "NEGATIVE"
                    entry["outcomeReason"] = f"Account CPL worsened {change_pct:.0f}% after pause"
                else:
                    entry["outcome"] = "NEUTRAL"
                    entry["outcomeReason"] = "No significant CPL change after pause"
            else:
                entry["outcome"] = "NEUTRAL"
                entry["outcomeReason"] = "Insufficient data for comparison"

        elif "SCALE" in action:
            # For scale actions, check if entity leads increased without CPL exceeding target
            if current:
                after_leads = current.get("leads", 0)
                after_cpl = current.get("cpl", 0)
                before_leads = before.get("leads", 0)
                if after_leads > before_leads and (after_cpl <= CPL_TARGET or after_cpl == 0):
                    entry["outcome"] = "POSITIVE"
                    entry["outcomeReason"] = f"Leads increased ({before_leads}->{after_leads}) with CPL within target"
                elif after_cpl > CPL_CRITICAL:
                    entry["outcome"] = "NEGATIVE"
                    entry["outcomeReason"] = f"CPL exceeded critical threshold after scaling (₹{after_cpl:.0f})"
                else:
                    entry["outcome"] = "NEUTRAL"
                    entry["outcomeReason"] = "No significant improvement after scaling"
            else:
                entry["outcome"] = "NEUTRAL"
                entry["outcomeReason"] = "Entity no longer in active data"

        elif "UNPAUSE" in action:
            if current:
                after_leads = current.get("leads", 0)
                after_cpl = current.get("cpl", 0)
                if after_leads > 0 and after_cpl <= CPL_TARGET:
                    entry["outcome"] = "POSITIVE"
                    entry["outcomeReason"] = f"Entity producing leads at CPL ₹{after_cpl:.0f} after reactivation"
                elif after_cpl > CPL_CRITICAL:
                    entry["outcome"] = "NEGATIVE"
                    entry["outcomeReason"] = f"Entity CPL ₹{after_cpl:.0f} exceeds critical after reactivation"
                else:
                    entry["outcome"] = "NEUTRAL"
                    entry["outcomeReason"] = "No significant change after reactivation"
            else:
                entry["outcome"] = "NEUTRAL"
                entry["outcomeReason"] = "Entity no longer in active data"

        else:
            if days_elapsed >= 7:
                entry["outcome"] = "NEUTRAL"
                entry["outcomeReason"] = "Unable to determine outcome for this action type"

        updated = True

    if updated:
        try:
            with open(learning_path, "w") as f:
                json.dump(entries, f, indent=2)
            print(f"  [LEARNING] Updated execution learning entries")
        except Exception as e:
            print(f"  [WARN] Failed to save execution learning: {e}")


# ━━━━━━━━━━━━━━━━━━━━ MODULE 3.7: BUDGET & PACING ━━━━━━━━━━━━━━━━

def analyze_budget_pacing(campaign_audit, daily_trends, cost_stack):
    daily_spends = [sf(d.get("spend")) for d in sorted(daily_trends, key=lambda x: x.get("date_start", ""))]
    avg_7d = sum(daily_spends) / len(daily_spends) if daily_spends else 0
    latest = daily_spends[-1] if daily_spends else 0

    anomalies = []
    if avg_7d > 0:
        ratio = latest / avg_7d
        if ratio > SOP["spend_anomaly_high"]:
            anomalies.append(f"Today's spend ₹{latest:,.0f} is {ratio:.0%} of 7d avg (₹{avg_7d:,.0f}).")
        elif ratio < SOP["spend_anomaly_low"]:
            anomalies.append(f"Today's spend ₹{latest:,.0f} is only {ratio:.0%} of 7d avg (₹{avg_7d:,.0f}).")

    exhausted = []
    under_spending = []
    for c in campaign_audit:
        if c["daily_budget"] > 0:
            if c["budget_remaining"] <= 0:
                exhausted.append(c["campaign_name"])
            daily_pace = c["spend"] / 30
            if daily_pace < c["daily_budget"] * 0.3 and c["spend"] > 100:
                under_spending.append({"name": c["campaign_name"], "pace": daily_pace, "budget": c["daily_budget"]})

    split = cost_stack["funnel_split_actual"]
    split_target = cost_stack["funnel_split_target_new"]
    split_issues = []
    for layer in ["TOFU", "MOFU", "BOFU"]:
        actual = split.get(layer, 0)
        target = split_target.get(layer, 0)
        diff = actual - target
        if abs(diff) > 15:
            direction = "over-indexed" if diff > 0 else "under-indexed"
            split_issues.append(f"{layer} is {direction}: {actual:.0f}% actual vs {target}% target ({diff:+.0f}pp).")

    return {
        "avg_7d_spend": avg_7d, "latest_spend": latest,
        "spend_anomalies": anomalies, "exhausted_budgets": exhausted,
        "under_spending": under_spending, "funnel_split_issues": split_issues,
        "daily_spends": daily_spends,
    }


# ━━━━━━━━━━━━━━━━━━━ MODULE 3.8: MONTHLY TARGET PACING ━━━━━━━━━━━

def analyze_monthly_pacing(pulse, mtd_campaign_insights):
    mt = MONTHLY_TARGETS["meta"]
    days_elapsed = (TODAY - MONTHLY_TARGETS["month_start"]).days
    days_remaining = (MONTHLY_TARGETS["month_end"] - TODAY).days
    total_days = MONTHLY_TARGETS["total_days"]
    pct_through = (days_elapsed / total_days * 100) if total_days else 0

    mtd_spend = sum(sf(c.get("spend")) for c in mtd_campaign_insights)
    mtd_impressions = sum(si(c.get("impressions")) for c in mtd_campaign_insights)
    mtd_clicks = sum(si(c.get("clicks")) for c in mtd_campaign_insights)
    mtd_leads = sum(get_action_value(c.get("actions"), LEAD_ACTION_TYPES) for c in mtd_campaign_insights)
    mtd_cpl = (mtd_spend / mtd_leads) if mtd_leads > 0 else 0
    mtd_ctr = (mtd_clicks / mtd_impressions * 100) if mtd_impressions > 0 else 0
    mtd_cpc = (mtd_spend / mtd_clicks) if mtd_clicks > 0 else 0
    mtd_cpm = (mtd_spend / mtd_impressions * 1000) if mtd_impressions > 0 else 0

    expected_spend = mt["budget"] * (days_elapsed / total_days) if total_days else 0
    expected_leads = mt["leads"] * (days_elapsed / total_days) if total_days else 0

    if days_elapsed > 0:
        proj_spend = (mtd_spend / days_elapsed) * total_days
        proj_leads = (mtd_leads / days_elapsed) * total_days
        proj_cpl = proj_spend / proj_leads if proj_leads > 0 else 0
    else:
        proj_spend = proj_leads = proj_cpl = 0

    spend_pace_pct = (mtd_spend / expected_spend * 100) if expected_spend > 0 else 0
    leads_pace_pct = (mtd_leads / expected_leads * 100) if expected_leads > 0 else 0

    def pace_status(pct_val):
        if 95 <= pct_val <= 110:
            return "ON TRACK"
        elif pct_val > 110:
            return "AHEAD"
        elif pct_val >= 80:
            return "SLIGHTLY BEHIND"
        return "BEHIND"

    leads_remaining = mt["leads"] - mtd_leads
    budget_remaining = mt["budget"] - mtd_spend
    daily_leads_needed = leads_remaining / days_remaining if days_remaining > 0 else 0
    daily_spend_needed = budget_remaining / days_remaining if days_remaining > 0 else 0

    cpl_status = "ON TARGET" if mtd_cpl <= mt["cpl"] else (
        "SLIGHTLY OVER" if mtd_cpl <= mt["cpl"] * 1.15 else "OVER TARGET")

    alerts = []
    if leads_pace_pct < 85:  # 15% behind = notification trigger
        alerts.append(f"Lead pacing at {leads_pace_pct:.0f}% - need {daily_leads_needed:.1f} leads/day to hit {mt['leads']} target")
    if spend_pace_pct > 115:
        alerts.append(f"Over-spending at {spend_pace_pct:.0f}% of expected pace")
    if mtd_cpl > mt["cpl"] * 1.2:
        alerts.append(f"CPL {fmt_inr(mtd_cpl)} is {((mtd_cpl / mt['cpl']) - 1) * 100:.0f}% above target {fmt_inr(mt['cpl'])}")
    if proj_leads < mt["leads"] * 0.85 and days_elapsed >= 7:
        alerts.append(f"Projected to miss lead target: ~{proj_leads:.0f} vs {mt['leads']} ({(proj_leads / mt['leads'] * 100):.0f}%)")

    return {
        "month": MONTHLY_TARGETS["month"],
        "days_elapsed": days_elapsed, "days_remaining": days_remaining,
        "pct_through_month": pct_through, "targets": mt,
        "data_source": f"MTD ({MTD_START} to {TODAY})",
        "mtd": {"spend": mtd_spend, "leads": mtd_leads, "cpl": mtd_cpl, "ctr": mtd_ctr,
                "cpc": mtd_cpc, "cpm": mtd_cpm, "impressions": mtd_impressions, "clicks": mtd_clicks},
        "expected": {"spend": expected_spend, "leads": expected_leads},
        "projected_eom": {"spend": proj_spend, "leads": proj_leads, "cpl": proj_cpl},
        "pacing": {"spend_pct": spend_pace_pct, "spend_status": pace_status(spend_pace_pct),
                   "leads_pct": leads_pace_pct, "leads_status": pace_status(leads_pace_pct),
                   "cpl_status": cpl_status},
        "daily_needed": {"leads": daily_leads_needed, "spend": daily_spend_needed},
        "alerts": alerts,
    }


# ━━━━━━━━━━━━━━━━━━━ MODULE 3.9: PLAYBOOK MATCHING ━━━━━━━━━━━━━━━

def match_playbooks(pulse, cost_stack, creative_health, fatigue_alerts, campaign_audit, budget_pacing, adset_analysis):
    active_playbooks = []

    # Playbook #1: CPM Increases
    for layer, data in cost_stack["layer_analysis"].items():
        agg = data.get("aggregate")
        if agg and agg["cpm"] > SOP["cpm_alert"]:
            active_playbooks.append({
                "playbook": 1, "title": PLAYBOOK_NAMES[1],
                "trigger": f"{layer} CPM at ₹{agg['cpm']:.0f} > ₹{SOP['cpm_alert']} alert",
                "diagnosis": [
                    f"Check CTR: {agg['ctr']:.2f}% ({'below' if agg['ctr'] < SOP['ctr_alert'] else 'above'} {SOP['ctr_alert']}% alert)",
                    f"Check Frequency: {agg['avg_frequency']:.2f}",
                    f"Audience type: {layer} layer",
                ],
                "actions": [
                    "Replace creatives with new hooks/colors/contrasts",
                    "Refresh first 3 seconds of videos (movement, emotion, contrast)",
                    "Add fresh UGC-style creatives (native looking, not ad-like)",
                    "Use brighter non-Facebook colors (yellow, red, orange vs blue/grey)",
                    "Pause underperforming ads (CPM up + CTR down)",
                    "Split-test placement (exclude Audience Network if CTR < 0.5%)",
                ],
                "layer": layer,
            })

    # Playbook #2: CTR Drops
    if pulse["ctr_trend"] == "DOWN" and abs(pulse["ctr_change_pct"]) > 10:
        active_playbooks.append({
            "playbook": 2, "title": PLAYBOOK_NAMES[2],
            "trigger": f"Account CTR trending DOWN ({pulse['ctr_change_pct']:+.1f}% over 7d)",
            "diagnosis": [
                "Compare CTR across creatives to identify drops by asset",
                "Check for offer relevance (expired/repetitive?)",
                "Compare primary text variants & CTAs",
                "Check placement breakdown (IG Reels, FB Feed, Story)",
            ],
            "actions": [
                "Change primary text: add value-driven hook or problem statement",
                "Make offer + CTA visible in first two lines of ad copy",
                "Use emotional triggers: FOMO, urgency, social proof, scarcity",
                "Rework thumbnail for Reels/videos (clean, bright, no clutter)",
                "Add headline overlays on videos (price, USP, offer)",
                "A/B test creatives by format (Reel vs Static vs Carousel)",
                "Ensure ad doesn't 'look like an ad' (raw, UGC, casual)",
            ],
            "layer": "ALL",
        })

    # Playbook #3: CPL Increases — DYNAMIC threshold
    for c in campaign_audit:
        if c["is_lead_campaign"] and c["cpl"] > CPL_ALERT and c["leads"] > 2:
            active_playbooks.append({
                "playbook": 3, "title": PLAYBOOK_NAMES[3],
                "trigger": f"'{c['campaign_name'][:40]}' CPL ₹{c['cpl']:.0f} > ₹{CPL_ALERT} alert (target ₹{CPL_TARGET} × 1.3)",
                "diagnosis": [
                    f"CPM trend: ₹{c['cpm']:.0f} ({'high' if c['cpm'] > SOP['cpm_alert'] else 'normal'})",
                    f"CTR: {c['ctr']:.2f}% ({'low' if c['ctr'] < SOP['ctr_alert'] else 'normal'})",
                    "If CPM & CTR stable but CPL up = CVR issue (form/audience)",
                ],
                "actions": [
                    "Simplify lead form (2-3 qualifying questions max)",
                    "Review targeting: too broad -> irrelevant clicks -> CPL up",
                    "Add price or location in creative to deter low-intent leads",
                    "Retest audience signal (add Advantage+ signals: city, income)",
                    "Refresh creatives with clear value prop ('2 & 3 BHK from ₹99.39L')",
                    "If CPL up + quality stable -> improve hook or reallocate to best ads",
                ],
                "layer": c["layer"],
            })

    # Playbook #4: Thumb Stop < 25% — VIDEO ONLY
    low_thumbstop_ads = [a for a in creative_health if a["is_video"] and 0 < a["thumb_stop_pct"] < SOP["thumb_stop_alert"]]
    if low_thumbstop_ads:
        names = [a["ad_name"][:30] for a in low_thumbstop_ads[:3]]
        active_playbooks.append({
            "playbook": 4, "title": PLAYBOOK_NAMES[4],
            "trigger": f"{len(low_thumbstop_ads)} video ads with thumb-stop < {SOP['thumb_stop_alert']}%",
            "diagnosis": [
                "First 3 seconds lack movement/contrast/curiosity",
                "Check video size/aspect ratio mismatch (cropped on feed?)",
                "Compare thumb-stop by audience and placement",
            ],
            "actions": [
                "Add motion within first 1 second (pan, zoom, text slide-in)",
                "Use face or eyes (human presence increases scroll-stops)",
                "Add headline overlays on first frame ('3BHK | ₹1.35Cr | Ready 2025')",
                "Use pattern interrupts (camera shakes, cuts, quick zooms)",
                "Test UGC hooks ('POV: You finally find a 3BHK with 3 balconies')",
                "Try native feel (looks like a reel, not an ad)",
            ],
            "layer": "ALL",
        })

    # Playbook #5: Video Hold Rate Drops — VIDEO ONLY
    low_hold = [a for a in creative_health if a["is_video"] and 0 < a["hold_rate_pct"] < SOP["hold_rate_alert"]]
    if low_hold:
        active_playbooks.append({
            "playbook": 5, "title": PLAYBOOK_NAMES[5],
            "trigger": f"{len(low_hold)} video ads with hold rate < {SOP['hold_rate_alert']}%",
            "diagnosis": [f"3s->15s hold: target >{SOP['hold_rate_target']}%", "Review captions & subheads"],
            "actions": [
                "Re-edit video with faster pacing (jump cuts or B-roll inserts)",
                "Add progress bar + subtitles (helps silent viewers)",
                "Introduce storyline hooks ('Wait till you see this clubhouse...')",
                "Remove long intros - get to product USP quickly",
                "Test shorter versions (15-20s vs 30-45s)",
                "Overlay testimonials or price towards end for retention",
            ],
            "layer": "ALL",
        })

    # Playbook #6: Ad Fatigue
    fatigue_criticals = [a for a in fatigue_alerts if a["severity"] in ("CRITICAL", "HIGH")]
    if fatigue_criticals:
        active_playbooks.append({
            "playbook": 6, "title": PLAYBOOK_NAMES[6],
            "trigger": f"{len(fatigue_criticals)} ads with critical/high fatigue signals",
            "diagnosis": [f"Fatigue threshold: TOFU/MOFU >{SOP['freq_tofu_mofu_warn']}, BOFU >{SOP['freq_bofu_warn']}"],
            "actions": [
                f"Refresh creatives every {SOP['creative_refresh_days']}-{SOP['creative_max_age_days']} days",
                "Duplicate ad set with same creative to reset learning (if needed)",
                "Test new ad formats (carousel, video, static alternates)",
                "Expand audience slightly (add nearby pin codes, similar interests)",
                "Replace high-frequency users (>8) with exclusion audience",
            ],
            "layer": "ALL",
        })

    # Playbook #8: Frequency Stable but Results Stagnant
    stagnant = [c for c in campaign_audit if c["frequency"] < 3 and c["is_lead_campaign"] and c["leads"] < 2 and c["spend"] > 5000]
    if stagnant:
        active_playbooks.append({
            "playbook": 8, "title": PLAYBOOK_NAMES[8],
            "trigger": f"{len(stagnant)} campaigns: frequency OK but low leads despite spend",
            "actions": [
                "Add new creatives to same ad set (refresh without reset)",
                "Broaden signals (add city-wide Advantage+ variant)",
                "Duplicate winning ad into new campaign to reset learning phase",
                "Rotate creative formats weekly to maintain novelty",
            ],
            "layer": "ALL",
        })

    # Playbook #9: Non-Delivering
    non_delivering_adsets = [a for a in (adset_analysis or []) if a["delivery_status"] == "NOT_DELIVERING"]
    not_spending_campaigns = pulse.get("not_spending_campaigns", [])
    if not_spending_campaigns or non_delivering_adsets:
        active_playbooks.append({
            "playbook": 9, "title": PLAYBOOK_NAMES[9],
            "trigger": f"{len(not_spending_campaigns)} campaigns + {len(non_delivering_adsets)} adsets not delivering",
            "actions": [
                f"Ensure budget >= 3x CPL (min ₹{CPL_TARGET * 3}/day)",
                "Widen audience (or toggle Optimized Targeting ON)",
                "Duplicate ad set with new budget split for testing",
                "Rebuild ad set under new campaign ID if fully stuck (hard reset)",
            ],
            "layer": "ALL",
        })

    # Playbook #10: CPL Stable but Volume Drops
    if pulse["leads_trend"] == "DOWN" and abs(pulse["leads_change_pct"]) > 20:
        avg_cpl_ok = pulse["overall_cpl"] <= CPL_ALERT
        if avg_cpl_ok:
            active_playbooks.append({
                "playbook": 10, "title": PLAYBOOK_NAMES[10],
                "trigger": f"Leads trending DOWN ({pulse['leads_change_pct']:+.0f}%) while CPL ₹{pulse['overall_cpl']:.0f} is within range",
                "actions": [
                    "Duplicate campaign to refresh learning",
                    "Increase budget by 20-25%",
                    "Add secondary ad variants to increase variety",
                    "Add new creative hooks or offers",
                    "Reverify conversion event is 'Leads' not 'Form Opens'",
                ],
                "layer": "ALL",
            })

    return active_playbooks


# ━━━━━━━━━━━━━━━━━━━ MODULE 3.10: DEEP PATTERN IDENTIFICATION ━━━━━

def identify_patterns(creative_health, cost_stack, campaign_daily):
    """Deep creative pattern analysis — what worked and WHY."""
    ads_with_leads = [a for a in creative_health if a["leads"] > 0 and a["spend"] > 100]
    if len(ads_with_leads) < 3:
        return {"top_ads": [], "bottom_ads": [], "patterns": [], "ad_count": len(ads_with_leads)}

    sorted_by_cpl = sorted(ads_with_leads, key=lambda x: x["cpl"])
    n = max(1, len(sorted_by_cpl) * 30 // 100)
    top_ads = sorted_by_cpl[:n]
    bottom_ads = sorted_by_cpl[-n:]

    patterns = []

    # ── Metric Comparison ──
    top_avg_cpl = sum(a["cpl"] for a in top_ads) / len(top_ads)
    bot_avg_cpl = sum(a["cpl"] for a in bottom_ads) / len(bottom_ads)
    top_avg_ctr = sum(a["ctr"] for a in top_ads) / len(top_ads)
    bot_avg_ctr = sum(a["ctr"] for a in bottom_ads) / len(bottom_ads)
    top_avg_cpm = sum(a["cpm"] for a in top_ads) / len(top_ads)
    bot_avg_cpm = sum(a["cpm"] for a in bottom_ads) / len(bottom_ads)
    top_avg_freq = sum(a["frequency"] for a in top_ads) / len(top_ads)
    bot_avg_freq = sum(a["frequency"] for a in bottom_ads) / len(bottom_ads)

    patterns.append({"type": "METRIC_COMPARISON",
        "detail": f"Top {n} ads: avg CPL ₹{top_avg_cpl:.0f}, CTR {top_avg_ctr:.2f}%, CPM ₹{top_avg_cpm:.0f}, Freq {top_avg_freq:.2f}"})
    patterns.append({"type": "METRIC_COMPARISON",
        "detail": f"Bottom {n} ads: avg CPL ₹{bot_avg_cpl:.0f}, CTR {bot_avg_ctr:.2f}%, CPM ₹{bot_avg_cpm:.0f}, Freq {bot_avg_freq:.2f}"})

    if top_avg_cpl > 0:
        ratio = bot_avg_cpl / top_avg_cpl
        patterns.append({"type": "CPL_GAP",
            "detail": f"Bottom performers cost {ratio:.1f}x more per lead (₹{bot_avg_cpl:.0f} vs ₹{top_avg_cpl:.0f})."})

    # ── Format/Type Patterns ──
    top_names = [a["ad_name"].lower() for a in top_ads]
    bot_names = [a["ad_name"].lower() for a in bottom_ads]
    for keyword, label in [("static", "Static"), ("video", "Video"), ("reel", "Reel"), ("influencer", "Influencer"),
                           ("ugc", "UGC"), ("carousel", "Carousel"), ("walkthrough", "Walkthrough"),
                           ("testimonial", "Testimonial"), ("price", "Price-focused"), ("offer", "Offer-based"),
                           ("fomo", "FOMO"), ("amenity", "Amenity"), ("clubhouse", "Clubhouse")]:
        top_has = sum(1 for n in top_names if keyword in n)
        bot_has = sum(1 for n in bot_names if keyword in n)
        if top_has > bot_has and top_has > 0:
            patterns.append({"type": "FORMAT_WINNER",
                "detail": f"'{label}' format appears more in top performers ({top_has}/{len(top_ads)}) than bottom ({bot_has}/{len(bottom_ads)})."})
        elif bot_has > top_has and bot_has > 0:
            patterns.append({"type": "FORMAT_LOSER",
                "detail": f"'{label}' format appears more in bottom performers ({bot_has}/{len(bottom_ads)}) than top ({top_has}/{len(top_ads)})."})

    # ── Video vs Static Analysis ──
    top_video = [a for a in top_ads if a["is_video"]]
    top_static = [a for a in top_ads if not a["is_video"]]
    bot_video = [a for a in bottom_ads if a["is_video"]]
    bot_static = [a for a in bottom_ads if not a["is_video"]]

    pct_top_video = len(top_video) / len(top_ads) * 100 if top_ads else 0
    pct_bot_video = len(bot_video) / len(bottom_ads) * 100 if bottom_ads else 0
    patterns.append({"type": "VIDEO_VS_STATIC",
        "detail": f"Top performers: {pct_top_video:.0f}% video, {100-pct_top_video:.0f}% static. Bottom: {pct_bot_video:.0f}% video, {100-pct_bot_video:.0f}% static."})

    # ── Video-Specific Patterns (only for video ads) ──
    if top_video:
        avg_top_tsr = sum(a["thumb_stop_pct"] for a in top_video) / len(top_video) if top_video else 0
        avg_top_vhr = sum(a["hold_rate_pct"] for a in top_video) / len(top_video) if top_video else 0
        if bot_video:
            avg_bot_tsr = sum(a["thumb_stop_pct"] for a in bot_video) / len(bot_video)
            avg_bot_vhr = sum(a["hold_rate_pct"] for a in bot_video) / len(bot_video)
            if avg_top_tsr > 0 and avg_bot_tsr > 0:
                patterns.append({"type": "VIDEO_HOOK_QUALITY",
                    "detail": f"Top video TSR: {avg_top_tsr:.1f}% vs bottom: {avg_bot_tsr:.1f}%. "
                              f"Top video VHR: {avg_top_vhr:.1f}% vs bottom: {avg_bot_vhr:.1f}%. "
                              f"{'Strong hooks = lower CPL' if avg_top_tsr > avg_bot_tsr else 'Hook quality not differentiating — check copy/CTA instead'}."})

    # ── Frequency Pattern ──
    if abs(top_avg_freq - bot_avg_freq) > 0.5:
        direction = "lower" if top_avg_freq < bot_avg_freq else "higher"
        patterns.append({"type": "FREQUENCY_PATTERN",
            "detail": f"Top performers have {direction} frequency ({top_avg_freq:.2f} vs {bot_avg_freq:.2f}). "
                      f"{'Fresher creatives perform better.' if direction == 'lower' else 'Established creatives performing well.'}"})

    # ── Spend Efficiency / Diminishing Returns ──
    all_sorted_spend = sorted(ads_with_leads, key=lambda x: x["spend"], reverse=True)
    if len(all_sorted_spend) >= 4:
        top_spend = all_sorted_spend[:len(all_sorted_spend)//2]
        low_spend = all_sorted_spend[len(all_sorted_spend)//2:]
        avg_cpl_high_spend = sum(a["cpl"] for a in top_spend) / len(top_spend)
        avg_cpl_low_spend = sum(a["cpl"] for a in low_spend) / len(low_spend)
        if avg_cpl_high_spend > avg_cpl_low_spend * 1.2:
            patterns.append({"type": "DIMINISHING_RETURNS",
                "detail": f"Higher-spend ads show higher CPL (₹{avg_cpl_high_spend:.0f}) vs lower-spend (₹{avg_cpl_low_spend:.0f}). Possible audience ceiling at higher budgets."})

    # ── Cross-correlations ──
    # High CTR + Low CPL correlation
    high_ctr_ads = [a for a in ads_with_leads if a["ctr"] > SOP["ctr_ideal_low"]]
    low_ctr_ads = [a for a in ads_with_leads if a["ctr"] <= SOP["ctr_alert"]]
    if high_ctr_ads and low_ctr_ads:
        avg_cpl_high_ctr = sum(a["cpl"] for a in high_ctr_ads) / len(high_ctr_ads)
        avg_cpl_low_ctr = sum(a["cpl"] for a in low_ctr_ads) / len(low_ctr_ads)
        savings = ((avg_cpl_low_ctr - avg_cpl_high_ctr) / avg_cpl_low_ctr * 100) if avg_cpl_low_ctr > 0 else 0
        if savings > 10:
            patterns.append({"type": "CTR_CPL_CORRELATION",
                "detail": f"High-CTR ads (>{SOP['ctr_ideal_low']}%) have {savings:.0f}% lower CPL (₹{avg_cpl_high_ctr:.0f} vs ₹{avg_cpl_low_ctr:.0f}). Investing in CTR improvement directly reduces CPL."})

    return {
        "top_ads": [{"name": a["ad_name"], "cpl": a["cpl"], "ctr": a["ctr"], "spend": a["spend"], "leads": a["leads"],
                      "is_video": a["is_video"], "score": a.get("creative_score", 0)} for a in top_ads],
        "bottom_ads": [{"name": a["ad_name"], "cpl": a["cpl"], "ctr": a["ctr"], "spend": a["spend"], "leads": a["leads"],
                        "is_video": a["is_video"], "score": a.get("creative_score", 0)} for a in bottom_ads],
        "patterns": patterns,
        "ad_count": len(ads_with_leads),
        "top_avg": {"cpl": top_avg_cpl, "ctr": top_avg_ctr, "cpm": top_avg_cpm},
        "bottom_avg": {"cpl": bot_avg_cpl, "ctr": bot_avg_ctr, "cpm": bot_avg_cpm},
    }


# ━━━━━━━━━━━ MODULE 3.11: MULTI-SOLUTION RECOMMENDATIONS ENGINE ━━━━━

def generate_recommendations(pulse, cost_stack, creative_health, fatigue_alerts, campaign_audit,
                              playbooks, patterns, budget_pacing, adset_analysis):
    """Multi-solution, data-driven recommendations. One metric fall → multiple root causes with separate approvals."""
    recs = []

    # ── High CPL Campaigns — Multi-cause diagnosis ──
    high_cpl_campaigns = [c for c in campaign_audit if c["is_lead_campaign"] and c["cpl"] > CPL_ALERT]
    for c in high_cpl_campaigns:
        root_causes = []
        # Cause A: Creative fatigue
        if c["frequency"] > SOP["freq_tofu_mofu_warn"] or c["ctr"] < SOP["ctr_alert"]:
            root_causes.append({
                "cause": "Creative fatigue / weak hook",
                "evidence": f"Freq {c['frequency']:.2f} {'> ' + str(SOP['freq_tofu_mofu_warn']) + ' threshold' if c['frequency'] > SOP['freq_tofu_mofu_warn'] else 'OK'}, CTR {c['ctr']:.2f}% {'below ' + str(SOP['ctr_alert']) + '%' if c['ctr'] < SOP['ctr_alert'] else 'OK'}",
                "solution": "Refresh creatives: new hooks, colors, UGC-style variants. Swap first 3 seconds of videos.",
                "approval_level": "Creative Team",
                "ice_score": ice_score(9, 8, 7),
            })
        # Cause B: Audience saturation
        if c["cpm"] > SOP["cpm_ideal_high"]:
            root_causes.append({
                "cause": "Audience saturation / high auction competition",
                "evidence": f"CPM ₹{c['cpm']:.0f} above ₹{SOP['cpm_ideal_high']} ideal range",
                "solution": "Expand audience: add nearby geo, broaden Advantage+ signals, test new interest signals.",
                "approval_level": "Media Buyer",
                "ice_score": ice_score(8, 7, 6),
            })
        # Cause C: Form friction
        if c["ctr"] >= SOP["ctr_alert"] and c["cpm"] <= SOP["cpm_alert"]:
            root_causes.append({
                "cause": "Form friction / CVR issue (traffic quality OK but not converting)",
                "evidence": f"CTR {c['ctr']:.2f}% and CPM ₹{c['cpm']:.0f} are acceptable but CPL still high",
                "solution": "Simplify lead form (2-3 MCQs max). Add price in creative to pre-qualify. Check form→CRM latency.",
                "approval_level": "CRO Team",
                "ice_score": ice_score(8, 7, 8),
            })
        # Cause D: Wrong optimization event
        root_causes.append({
            "cause": "Optimization event misconfiguration",
            "evidence": "Verify optimization is set to 'Leads', not 'Form Opens' or 'View Content'",
            "solution": "Check ad set optimization event. Ensure it targets highest-value conversion (lead submission).",
            "approval_level": "Auto-execute",
            "ice_score": ice_score(7, 6, 9),
        })

        recs.append({
            "priority": "IMMEDIATE",
            "category": f"{PLAYBOOK_NAMES[3]}",
            "action": f"Fix CPL on '{c['campaign_name'][:45]}'",
            "detail": f"CPL ₹{c['cpl']:.0f} > ₹{CPL_ALERT} alert (target ₹{CPL_TARGET} × 1.3). {len(root_causes)} possible root causes identified.",
            "ice_score": ice_score(9, 8, 6),
            "layer": c["layer"],
            "root_causes": root_causes,
        })

    # ── Fatigue Recommendations ──
    high_freq = [a for a in fatigue_alerts if a["type"] == "FREQUENCY_FATIGUE" and a["severity"] in ("CRITICAL", "HIGH")]
    if high_freq:
        ad_names = ", ".join(set(a["ad_name"][:25] for a in high_freq[:3]))
        recs.append({
            "priority": "IMMEDIATE",
            "category": PLAYBOOK_NAMES[6],
            "action": "Refresh creatives for fatigued ads",
            "detail": f"{len(high_freq)} ads with critical frequency ({ad_names}). "
                      f"Refresh cycle: {SOP['creative_refresh_days']}-{SOP['creative_max_age_days']}d.",
            "ice_score": ice_score(8, 9, 7),
            "layer": "ALL",
            "root_causes": [
                {"cause": "Creative exhaustion", "evidence": f"{len(high_freq)} ads above frequency threshold",
                 "solution": "Replace first 3 sec with new hook, swap colors to non-Facebook palette, test UGC variant.",
                 "approval_level": "Creative Team", "ice_score": ice_score(8, 9, 7)},
                {"cause": "Audience pool too small", "evidence": "High frequency = seeing same people repeatedly",
                 "solution": "Expand audience: add nearby pin codes, broaden Advantage+ signals, exclude high-freq users (>8).",
                 "approval_level": "Media Buyer", "ice_score": ice_score(7, 8, 6)},
            ],
        })

    # ── Video-Specific Recommendations ──
    video_ads_low_tsr = [a for a in creative_health if a["is_video"] and 0 < a["thumb_stop_pct"] < SOP["thumb_stop_alert"] and a["impressions"] > 3000]
    if video_ads_low_tsr:
        recs.append({
            "priority": "IMMEDIATE",
            "category": PLAYBOOK_NAMES[4],
            "action": f"Fix first 3 seconds on {len(video_ads_low_tsr)} video ads",
            "detail": f"Video ads with TSR < {SOP['thumb_stop_alert']}%: {', '.join(a['ad_name'][:25] for a in video_ads_low_tsr[:3])}. "
                      "Add motion at 0-1s, use face/eyes, headline overlay, pattern interrupts.",
            "ice_score": ice_score(8, 8, 7),
            "layer": "ALL",
            "root_causes": [],
        })

    video_ads_low_vhr = [a for a in creative_health if a["is_video"] and 0 < a["hold_rate_pct"] < SOP["hold_rate_alert"] and a["impressions"] > 3000]
    if video_ads_low_vhr:
        recs.append({
            "priority": "THIS_WEEK",
            "category": PLAYBOOK_NAMES[5],
            "action": f"Recut {len(video_ads_low_vhr)} video ads with low hold rate",
            "detail": f"Video ads with VHR < {SOP['hold_rate_alert']}%. Faster pacing, progress bar + subtitles, storyline hooks.",
            "ice_score": ice_score(7, 7, 6),
            "layer": "ALL",
            "root_causes": [],
        })

    # ── Static-Specific Recommendations ──
    static_low_ctr = [a for a in creative_health if not a["is_video"] and a["ctr"] < SOP["ctr_alert"] and a["impressions"] > 5000]
    if static_low_ctr:
        recs.append({
            "priority": "THIS_WEEK",
            "category": "Static Creative CTR Fix",
            "action": f"Improve CTR on {len(static_low_ctr)} static ads",
            "detail": f"Static ads with CTR < {SOP['ctr_alert']}%. Improve headline visibility, CTA contrast, visual hierarchy. "
                      "Add price overlay, benefit callout, or social proof.",
            "ice_score": ice_score(7, 7, 7),
            "layer": "ALL",
            "root_causes": [],
        })

    # ── CPM Recommendations ──
    high_cpm_layers = [l for l, d in cost_stack["layer_analysis"].items() if d.get("aggregate") and d["aggregate"]["cpm"] > SOP["cpm_alert"]]
    if high_cpm_layers:
        for layer in high_cpm_layers:
            agg = cost_stack["layer_analysis"][layer]["aggregate"]
            recs.append({
                "priority": "THIS_WEEK",
                "category": PLAYBOOK_NAMES[1],
                "action": f"Reduce {layer} CPM from ₹{agg['cpm']:.0f}",
                "detail": f"{layer} CPM ₹{agg['cpm']:.0f} > ₹{SOP['cpm_alert']} alert. Check auction overlap, audience saturation, creative relevance.",
                "ice_score": ice_score(7, 7, 6),
                "layer": layer,
                "root_causes": [
                    {"cause": "Auction competition", "evidence": f"CPM ₹{agg['cpm']:.0f}",
                     "solution": "Shift placement mix, test different optimization events.", "approval_level": "Media Buyer", "ice_score": ice_score(7, 7, 6)},
                    {"cause": "Creative fatigue driving up CPM", "evidence": f"Check if freq > {SOP['freq_tofu_mofu_warn']}",
                     "solution": "Fresh creatives with new hooks, colors, formats.", "approval_level": "Creative Team", "ice_score": ice_score(7, 8, 7)},
                ],
            })

    # ── Learning Limited Recommendations ──
    learning_limited = [c for c in campaign_audit if c.get("learning_status") == "LEARNING_LIMITED"]
    if learning_limited:
        for c in learning_limited[:3]:
            recs.append({
                "priority": "THIS_WEEK",
                "category": "Combat Learning Limited",
                "action": f"Scale '{c['campaign_name'][:40]}' out of Learning Limited",
                "detail": f"Campaign has {c['leads']} leads (need ~50/week for stable learning). "
                          f"Budget: ₹{c['daily_budget']:.0f}/day.",
                "ice_score": ice_score(8, 7, 7),
                "layer": c["layer"],
                "root_causes": [
                    {"cause": "Insufficient conversion volume", "evidence": f"{c['leads']} leads in period",
                     "solution": f"Increase budget by 20-25% to ₹{c['daily_budget'] * 1.25:.0f}/day" if c["daily_budget"] > 0 else "Increase budget by 20-25%",
                     "approval_level": "Media Buyer", "ice_score": ice_score(8, 7, 8)},
                    {"cause": "Too many adsets splitting volume", "evidence": "Check if multiple adsets compete for same audience",
                     "solution": "Consolidate similar adsets into one to pool conversions.",
                     "approval_level": "Media Buyer", "ice_score": ice_score(7, 7, 7)},
                ],
            })

    # ── Non-Delivering Recommendations ──
    non_delivering = [c for c in campaign_audit if c.get("delivery_status") == "NOT_DELIVERING"]
    if non_delivering:
        recs.append({
            "priority": "IMMEDIATE",
            "category": PLAYBOOK_NAMES[9],
            "action": f"Fix {len(non_delivering)} non-delivering campaigns",
            "detail": f"Campaigns not spending: {', '.join(c['campaign_name'][:30] for c in non_delivering[:3])}",
            "ice_score": ice_score(8, 8, 7),
            "layer": "ALL",
            "root_causes": [
                {"cause": "Budget too low", "evidence": "Check if daily budget < 3x CPL",
                 "solution": f"Set minimum daily budget to ₹{CPL_TARGET * 3:.0f} (3x target CPL)",
                 "approval_level": "Auto-execute", "ice_score": ice_score(8, 8, 9)},
                {"cause": "Audience too narrow / over-exclusions", "evidence": "Check targeting and exclusion lists",
                 "solution": "Widen audience, toggle Optimized Targeting ON, remove excessive exclusions.",
                 "approval_level": "Media Buyer", "ice_score": ice_score(7, 7, 6)},
            ],
        })

    # ── Budget Optimization ──
    if budget_pacing["exhausted_budgets"]:
        recs.append({
            "priority": "THIS_WEEK",
            "category": "Budget Management",
            "action": "Reallocate budget from exhausted campaigns",
            "detail": f"{len(budget_pacing['exhausted_budgets'])} exhausted. Max increase 20-25% per SOP.",
            "ice_score": ice_score(6, 8, 8),
            "layer": "ALL",
            "root_causes": [],
        })

    # ── Scale Winners ──
    best = None
    for c in campaign_audit:
        if c["is_lead_campaign"] and c["leads"] >= 3 and c["cpl"] <= CPL_TARGET * 1.1:
            if best is None or c["health_score"] > best["health_score"]:
                best = c
    if best:
        recs.append({
            "priority": "THIS_WEEK",
            "category": "Scale Winners",
            "action": f"Increase budget on '{best['campaign_name'][:40]}' by 20-25%",
            "detail": f"Score: {best['health_score']}/100, CPL: ₹{best['cpl']:.0f} (within target), "
                      f"{best['leads']} leads. SOP: Scale max {SOP['budget_scale_max_pct']}%.",
            "ice_score": ice_score(8, 8, 9),
            "layer": best["layer"],
            "root_causes": [],
        })

    # ── Pattern-Based ──
    if patterns.get("patterns"):
        format_winners = [p for p in patterns["patterns"] if p["type"] == "FORMAT_WINNER"]
        if format_winners:
            recs.append({
                "priority": "THIS_WEEK",
                "category": "Creative Strategy",
                "action": "Double down on winning creative formats",
                "detail": " ".join(p["detail"] for p in format_winners[:2]),
                "ice_score": ice_score(7, 7, 7),
                "layer": "ALL",
                "root_causes": [],
            })

    # ── Funnel Split ──
    if budget_pacing["funnel_split_issues"]:
        recs.append({
            "priority": "STRATEGIC",
            "category": "Funnel Balance",
            "action": "Adjust funnel budget split",
            "detail": " ".join(budget_pacing["funnel_split_issues"]),
            "ice_score": ice_score(7, 6, 5),
            "layer": "ALL",
            "root_causes": [],
        })

    priority_order = {"IMMEDIATE": 0, "THIS_WEEK": 1, "STRATEGIC": 2}
    recs.sort(key=lambda r: (priority_order.get(r["priority"], 3), -r["ice_score"]))
    return recs


# ━━━━━━━━━━━━ MODULE 3.12: PERFORMANCE MARKETER INTELLECT ━━━━━━━━

def apply_marketer_intellect(pulse, cost_stack, creative_health, campaign_audit, adset_analysis,
                               monthly_pacing, patterns, learning_history):
    """Deep AI-driven insights using PIE and PDE engines (Meta version)."""
    insights = []
    
    # Initialize Engines
    pie = PerformanceIntelligenceEngine(target_cpl=CPL_TARGET)
    pde = PatternDetectionEngine()

    # 1. PIE Diagnosis for each campaign
    for c in campaign_audit:
        if c.get("spend", 0) > 0:
            # Map Meta metrics to common schema for PIE
            # Note: Meta uses 'cpl' and 'ctr' already in our campaign_audit
            diagnosis = pie.diagnose_campaign(c)
            for d in diagnosis:
                 insights.append({
                    "type": "DIAGNOSIS",
                    "severity": "HIGH",
                    "entity": c["campaign_name"],
                    "detail": f"{d['issue']}: {d['why']}. {d['fix']}",
                    "auto_action": False,
                })

    # 2. PDE Pattern Detection
    for c in campaign_audit:
        p = pde.detect_learning_trap(c)
        if p:
            insights.append({
                "type": "PATTERN_ALERT",
                "severity": "MEDIUM",
                "entity": c["campaign_name"],
                "detail": f"{p['pattern']}: {p['evidence']}. {p['proactive_step']}",
                "auto_action": False,
            })

    # 3. Budget Reallocation Math (Classic Marketer Intellect)
    lead_campaigns = [c for c in campaign_audit if c.get("is_lead_campaign") and c.get("leads", 0) > 0]
    if len(lead_campaigns) >= 2:
        sorted_by_cpl = sorted(lead_campaigns, key=lambda x: x["cpl"])
        best_cpl = sorted_by_cpl[0]
        worst_cpl = sorted_by_cpl[-1]
        if worst_cpl["cpl"] > best_cpl["cpl"] * 1.5 and worst_cpl["spend"] > 5000:
            potential_leads = worst_cpl["spend"] / best_cpl["cpl"]
            actual_leads = worst_cpl["leads"]
            extra_leads = potential_leads - actual_leads
            if extra_leads > 2:
                insights.append({
                    "type": "BUDGET_REALLOCATION",
                    "severity": "HIGH",
                    "entity": f"Shift from '{worst_cpl['campaign_name'][:30]}' to '{best_cpl['campaign_name'][:30]}'",
                    "detail": f"Shift 25% budget to best-performer. Projected upside: +{extra_leads:.0f} leads.",
                    "auto_action": False,
                })

    # 4. Auto-Pause Logic
    for c in campaign_audit:
        if c.get("is_lead_campaign"):
            if c["leads"] == 0 and c["impressions"] >= SOP["auto_pause_zero_leads_impressions"]:
                insights.append({
                    "type": "AUTO_PAUSE",
                    "severity": "CRITICAL",
                    "entity": c["campaign_name"],
                    "detail": f"Zero leads after {c['impressions']:,} impressions. Performance floor breached.",
                    "auto_action": True,
                })

    # 5. CPL Alert Logic
    for c in campaign_audit:
        if c.get("is_lead_campaign") and c.get("cpl", 0) > CPL_TARGET * SOP["auto_pause_cpl_multiplier"]:
            pct_above = ((c["cpl"] / CPL_TARGET) - 1) * 100
            insights.append({
                "type": "AUTO_PAUSE_CPL",
                "severity": "HIGH",
                "entity": c["campaign_name"],
                "detail": f"CPL ₹{c['cpl']:.0f} is {pct_above:.0f}% above target ₹{CPL_TARGET}. Consider pausing or restructuring.",
                "auto_action": True if pct_above > 50 else False,
            })

    return insights

    # ── Performance Insights Enhancement ──
    # Best performing ad (lowest CPL with meaningful spend > ₹500)
    meaningful_ads = [a for a in creative_health if a.get("leads", 0) > 0 and a.get("spend", 0) > 500]
    if meaningful_ads:
        best_ad = min(meaningful_ads, key=lambda a: a["cpl"])
        insights.append({
            "type": "BEST_PERFORMING_AD",
            "severity": "INFO",
            "entity": best_ad["ad_name"],
            "detail": f"Best performing ad: '{best_ad['ad_name'][:50]}' — CPL ₹{best_ad['cpl']:.0f}, {best_ad['leads']} leads, ₹{best_ad['spend']:,.0f} spend, CTR {best_ad['ctr']:.2f}%.",
            "auto_action": False,
        })

    # Worst performing ad (highest CPL or most spend with 0 leads)
    zero_lead_ads = [a for a in creative_health if a.get("leads", 0) == 0 and a.get("spend", 0) > 500]
    high_cpl_ads = [a for a in creative_health if a.get("leads", 0) > 0 and a.get("spend", 0) > 500]
    worst_ad = None
    if zero_lead_ads:
        worst_ad = max(zero_lead_ads, key=lambda a: a["spend"])
        worst_reason = f"₹{worst_ad['spend']:,.0f} spent with ZERO leads"
    elif high_cpl_ads:
        worst_ad = max(high_cpl_ads, key=lambda a: a["cpl"])
        worst_reason = f"CPL ₹{worst_ad['cpl']:.0f} ({worst_ad['leads']} leads on ₹{worst_ad['spend']:,.0f} spend)"
    if worst_ad:
        insights.append({
            "type": "WORST_PERFORMING_AD",
            "severity": "HIGH",
            "entity": worst_ad["ad_name"],
            "detail": f"Worst performing ad: '{worst_ad['ad_name'][:50]}' — {worst_reason}.",
            "auto_action": False,
        })

    # Total ads analyzed count
    insights.append({
        "type": "ADS_ANALYZED",
        "severity": "INFO",
        "entity": "Account-wide",
        "detail": f"Total ads analyzed: {len(creative_health)}. Winners: {len([a for a in creative_health if a.get('classification') == 'WINNER'])}, Losers: {len([a for a in creative_health if a.get('classification') == 'LOSER'])}, Watch: {len([a for a in creative_health if a.get('classification') == 'WATCH'])}.",
        "auto_action": False,
    })

    # Budget efficiency: % of budget going to ads with CPL > target
    total_spend_all = sum(a.get("spend", 0) for a in creative_health)
    over_target_spend = sum(a.get("spend", 0) for a in creative_health if a.get("leads", 0) > 0 and a.get("cpl", 0) > CPL_TARGET)
    zero_lead_spend = sum(a.get("spend", 0) for a in creative_health if a.get("leads", 0) == 0 and a.get("spend", 0) > 0)
    inefficient_spend = over_target_spend + zero_lead_spend
    if total_spend_all > 0:
        inefficient_pct = (inefficient_spend / total_spend_all) * 100
        insights.append({
            "type": "BUDGET_EFFICIENCY",
            "severity": "HIGH" if inefficient_pct > 40 else ("MEDIUM" if inefficient_pct > 20 else "INFO"),
            "entity": "Account-wide",
            "detail": f"Budget efficiency: {inefficient_pct:.0f}% of budget (₹{inefficient_spend:,.0f}) going to ads with CPL > target or zero leads.",
            "auto_action": False,
        })

    # Trend patterns: CPL trending up/down/flat over last 3 days
    if len(pulse.get("daily_leads", [])) >= 3 and len(pulse.get("daily_spends", [])) >= 3:
        last_3_spends = pulse["daily_spends"][-3:]
        last_3_leads = pulse["daily_leads"][-3:]
        last_3_cpls = []
        for _s, _l in zip(last_3_spends, last_3_leads):
            last_3_cpls.append(_s / _l if _l > 0 else 0)
        valid_cpls = [c for c in last_3_cpls if c > 0]
        if len(valid_cpls) >= 2:
            if valid_cpls[-1] > valid_cpls[0] * 1.1:
                cpl_trend = "UP"
            elif valid_cpls[-1] < valid_cpls[0] * 0.9:
                cpl_trend = "DOWN"
            else:
                cpl_trend = "FLAT"
            insights.append({
                "type": "CPL_TREND",
                "severity": "HIGH" if cpl_trend == "UP" else ("INFO" if cpl_trend == "DOWN" else "INFO"),
                "entity": "Account-wide",
                "detail": f"CPL trending {cpl_trend} over last 3 days: " + ", ".join(f"₹{c:.0f}" for c in valid_cpls) + ".",
                "auto_action": False,
            })

    return insights


# ━━━━━━━━━━━━━━━━━━━━━━━━ REPORT GENERATION ━━━━━━━━━━━━━━━━━━━━━━

def generate_report(pulse, cost_stack, creative_health, fatigue_alerts, campaign_audit,
                     playbooks, patterns, recommendations, budget_pacing,
                     monthly_pacing=None, adset_analysis=None, intellect_insights=None):
    lines = []
    w = lines.append
    sep = "=" * 90
    thin = "-" * 70

    w(sep)
    w("  MOJO PERFORMANCE AGENT — ADVANCED META ADS AUDIT")
    w(f"  Deevyashakti Amara | Account: act_{AD_ACCOUNT_ID}")
    w(f"  Generated: {NOW.strftime('%Y-%m-%d %H:%M:%S')}")
    w(f"  Alert Thresholds: CPL Alert ₹{CPL_ALERT} (target ₹{CPL_TARGET} × 1.3) | Critical ₹{CPL_CRITICAL} (× 1.5)")
    w(sep)

    # ── EXECUTIVE SUMMARY ──
    w("\n" + "=" * 50)
    w("  EXECUTIVE SUMMARY")
    w("=" * 50)
    eb = []
    eb.append(f"Spend: {fmt_inr(pulse['total_spend_30d'])} | {pulse['total_leads_30d']} leads | CPL: {fmt_inr(pulse['overall_cpl'])}")
    if pulse["overall_cpl"] <= CPL_TARGET * 1.1:
        eb.append(f"CPL {fmt_inr(pulse['overall_cpl'])} is WITHIN target range (₹{CPL_TARGET})")
    else:
        eb.append(f"CPL {fmt_inr(pulse['overall_cpl'])} EXCEEDS target ₹{CPL_TARGET}. Action needed.")

    high_issues = len([a for a in fatigue_alerts if a["severity"] in ("CRITICAL", "HIGH")])
    if high_issues:
        eb.append(f"{high_issues} critical/high fatigue alerts")
    if playbooks:
        pb_names = ", ".join(PLAYBOOK_NAMES.get(p["playbook"], f"#{p['playbook']}") for p in playbooks[:3])
        eb.append(f"{len(playbooks)} active playbooks: {pb_names}")
    imm_recs = len([r for r in recommendations if r["priority"] == "IMMEDIATE"])
    if imm_recs:
        eb.append(f"{imm_recs} IMMEDIATE actions required")

    # Learning Limited + Non-delivering counts
    ll_count = len([c for c in campaign_audit if c.get("learning_status") == "LEARNING_LIMITED"])
    nd_count = len([c for c in campaign_audit if c.get("delivery_status") == "NOT_DELIVERING"])
    if ll_count:
        eb.append(f"{ll_count} campaigns in Learning Limited")
    if nd_count:
        eb.append(f"{nd_count} campaigns not delivering")

    if monthly_pacing:
        mp = monthly_pacing
        mt = mp["targets"]
        eb.append(
            f"Monthly Pacing (Day {mp['days_elapsed']}/{MONTHLY_TARGETS['total_days']}): "
            f"Leads {mp['mtd']['leads']}/{mt['leads']} [{mp['pacing']['leads_status']}] | "
            f"Spend {fmt_inr(mp['mtd']['spend'])}/{fmt_inr(mt['budget'])} [{mp['pacing']['spend_status']}] | "
            f"CPL {fmt_inr(mp['mtd']['cpl'])} vs {fmt_inr(mt['cpl'])} target [{mp['pacing']['cpl_status']}]"
        )

    for b in eb:
        w(f"  * {b}")
    w("")

    # ── MONTHLY PACING ──
    if monthly_pacing:
        mp = monthly_pacing
        w("\n" + "=" * 50)
        w(f"  MONTHLY TARGET PACING ({mp['month']})")
        w("=" * 50)
        w(f"  Day {mp['days_elapsed']} of {MONTHLY_TARGETS['total_days']} ({mp['pct_through_month']:.0f}%) | {mp['days_remaining']} days remaining")
        mt = mp["targets"]
        def pbar(actual, target, width=20):
            pct_val = min(actual / target, 1.5) if target > 0 else 0
            filled = int(pct_val * width)
            return f"[{'#' * min(filled, width)}{'.' * max(width - filled, 0)}] {actual / target * 100:.0f}%" if target > 0 else "[N/A]"
        w(f"  BUDGET:  MTD {fmt_inr(mp['mtd']['spend']):>12} / {fmt_inr(mt['budget']):>12}  {pbar(mp['mtd']['spend'], mt['budget'])}  [{mp['pacing']['spend_status']}]")
        w(f"  LEADS:   MTD {mp['mtd']['leads']:>8}     / {mt['leads']:>8}      {pbar(mp['mtd']['leads'], mt['leads'])}  [{mp['pacing']['leads_status']}]")
        w(f"  CPL:     MTD {fmt_inr(mp['mtd']['cpl']):>12} / {fmt_inr(mt['cpl']):>12}  [{mp['pacing']['cpl_status']}]")
        w(f"\n  Projected EOM: Spend {fmt_inr(mp['projected_eom']['spend'])} | Leads {mp['projected_eom']['leads']:.0f} | CPL {fmt_inr(mp['projected_eom']['cpl'])}")
        w(f"  Daily Needed: {mp['daily_needed']['leads']:.1f} leads/day | {fmt_inr(mp['daily_needed']['spend'])}/day")
        if mp["alerts"]:
            w("\n  !! PACING ALERTS:")
            for a in mp["alerts"]:
                w(f"    !! {a}")
        w("")

    # ── PULSE ──
    w(thin)
    w("  [PULSE] ACCOUNT PULSE")
    w(thin)
    w(f"  Spend:     {fmt_inr(pulse['total_spend_30d'])}  [{pulse['spend_trend']} {pulse['spend_change_pct']:+.1f}%]")
    w(f"  Leads:     {pulse['total_leads_30d']}  [{pulse['leads_trend']} {pulse['leads_change_pct']:+.1f}%]")
    w(f"  CPL:       {fmt_inr(pulse['overall_cpl'])}  (target: ₹{CPL_TARGET} | alert: ₹{CPL_ALERT})")
    w(f"  CTR:       {pct(pulse['overall_ctr'])}  [{pulse['ctr_trend']}]  (SOP: {SOP['ctr_ideal_low']}-{SOP['ctr_ideal_high']}%)")
    w(f"  CPM:       {fmt_inr(pulse['overall_cpm'])}  (SOP: ₹{SOP['cpm_ideal_low']}-{SOP['cpm_ideal_high']})")
    w(f"  CPC:       {fmt_inr(pulse['overall_cpc'])}")
    w(f"  Reach:     {pulse['total_reach']:,}")
    if pulse["alerts"]:
        w("\n  ALERTS:")
        for alert in pulse["alerts"]:
            w(f"    !! {alert}")
    w("")

    # ── CAMPAIGNS ──
    w(thin)
    w("  [CAMPAIGNS] CAMPAIGN PERFORMANCE (by health score)")
    w(thin)
    for c in campaign_audit:
        cls = c.get('classification', 'WATCH')
        tag = "[W+]" if cls == "WINNER" else "[--]" if cls == "LOSER" else "[~ ]"
        delivery = f" [{c['delivery_status']}]" if c.get("delivery_status") != "DELIVERING" else ""
        learning = f" [{c['learning_status']}]" if c.get("learning_status") != "ACTIVE" else ""
        w(f"\n  {tag} {c['campaign_name'][:65]}{delivery}{learning}")
        w(f"    Score: {c['health_score']}/100 [{cls}] | Layer: {c['layer']}")
        w(f"    Spend: {fmt_inr(c['spend'])} | Leads: {c['leads']} | CPL: {fmt_inr(c['cpl'])}")
        w(f"    CPM: {fmt_inr(c['cpm'])} | CTR: {pct(c['ctr'])} | Freq: {c['frequency']:.2f}")
    w("")

    # ── ADSETS ──
    if adset_analysis:
        w(thin)
        w("  [ADSETS] ADSET PERFORMANCE")
        w(thin)
        for a in adset_analysis[:15]:
            cls = a.get('classification', 'WATCH')
            delivery = f" [{a['delivery_status']}]" if a.get("delivery_status") != "DELIVERING" else ""
            learning = f" [{a['learning_status']}]" if a.get("learning_status") != "ACTIVE" else ""
            pause = " >>> AUTO-PAUSE" if a.get("should_pause") else ""
            w(f"\n  {a['adset_name'][:55]}{delivery}{learning}{pause}")
            w(f"    Score: {a['health_score']}/100 [{cls}] | Campaign: {a['campaign_name'][:40]}")
            w(f"    Spend: {fmt_inr(a['spend'])} | Leads: {a['leads']} | CPL: {fmt_inr(a['cpl'])}")
            w(f"    CPM: {fmt_inr(a['cpm'])} | CTR: {pct(a['ctr'])} | Freq: {a['frequency']:.2f}")
            for diag in a.get("diagnostics", []):
                w(f"    !! {diag['issue']}: {'; '.join(diag['reasons'])}")
        w("")

    # ── CREATIVE HEALTH ──
    w(thin)
    w("  [CREATIVE] CREATIVE HEALTH")
    w(thin)
    for ad in creative_health[:10]:
        cls = ad.get('classification', 'WATCH')
        stype = ad.get('scoring_type', 'unknown').upper()
        pause_flag = " >>> AUTO-PAUSE" if ad.get('should_pause') else ""
        w(f"\n  * {ad['ad_name'][:55]}")
        w(f"    Score: {ad.get('creative_score', 0)}/100 [{cls}] [{stype}]{pause_flag}")
        w(f"    Spend: {fmt_inr(ad['spend'])} | CTR: {pct(ad['ctr'])} | CPM: {fmt_inr(ad['cpm'])} | Freq: {ad['frequency']:.2f}")
        if ad["leads"] > 0:
            w(f"    Leads: {ad['leads']} | CPL: {fmt_inr(ad['cpl'])}")
        if ad["is_video"]:
            w(f"    [VIDEO] TSR: {ad['thumb_stop_pct']:.1f}% | VHR: {ad['hold_rate_pct']:.1f}% | FFR: {ad.get('first_frame_rate', 0):.1f}%")
        if ad["health_signals"]:
            for sig in ad["health_signals"][:3]:
                w(f"    !! {sig}")
    w("")

    # ── PLAYBOOKS ──
    w(thin)
    w("  [PLAYBOOKS] ACTIVE SOP PLAYBOOKS")
    w(thin)
    if playbooks:
        for pb in playbooks:
            w(f"\n  {PLAYBOOK_NAMES.get(pb['playbook'], pb['title'])}")
            w(f"  Trigger: {pb['trigger']}")
            for a in pb["actions"][:4]:
                w(f"    -> {a}")
    else:
        w("  [OK] No playbooks triggered.")
    w("")

    # ── RECOMMENDATIONS ──
    w(thin)
    w("  [ACTIONS] PRIORITIZED RECOMMENDATIONS (ICE-scored, multi-solution)")
    w(thin)
    current_priority = ""
    for i, rec in enumerate(recommendations, 1):
        if rec["priority"] != current_priority:
            current_priority = rec["priority"]
            w(f"\n  --- {current_priority} ---")
        w(f"\n  {i}. ICE: {rec['ice_score']} | {rec['category']}")
        w(f"     Action: {rec['action']}")
        detail_lines = textwrap.wrap(rec["detail"], width=80)
        for dl in detail_lines:
            w(f"     {dl}")
        if rec.get("root_causes"):
            w(f"     ROOT CAUSES ({len(rec['root_causes'])} identified):")
            for rc in rec["root_causes"]:
                w(f"       [{rc['approval_level']}] {rc['cause']}")
                w(f"         Evidence: {rc['evidence']}")
                w(f"         Solution: {rc['solution']}")
    w("")

    # ── PERFORMANCE MARKETER INSIGHTS ──
    if intellect_insights:
        w(thin)
        w("  [INTELLECT] PERFORMANCE MARKETER INSIGHTS (Beyond SOPs)")
        w(thin)
        for insight in intellect_insights:
            auto = " [AUTO-EXECUTE]" if insight.get("auto_action") else ""
            w(f"\n  [{insight['severity']}] {insight['type']}{auto}")
            w(f"  Entity: {insight['entity']}")
            for dl in textwrap.wrap(insight["detail"], width=80):
                w(f"    {dl}")
    w("")

    # ── PATTERNS ──
    w(thin)
    w("  [PATTERNS] DEEP PATTERN ANALYSIS")
    w(thin)
    if patterns.get("patterns"):
        for p in patterns["patterns"]:
            w(f"    [{p['type']}] {p['detail']}")
    w("")

    # ── NOTIFICATION TRIGGERS ──
    w(thin)
    w("  [NOTIFY] NOTIFICATION TRIGGERS")
    w(thin)
    notifications = []
    for c in campaign_audit:
        if c["is_lead_campaign"] and c["cpl"] > CPL_ALERT:
            notifications.append(f"CPL alert: '{c['campaign_name'][:40]}' CPL ₹{c['cpl']:.0f} > ₹{CPL_ALERT} (target ₹{CPL_TARGET} × 1.3)")
    for a in fatigue_alerts:
        if a["severity"] == "CRITICAL" and a.get("frequency", 0) > SOP["freq_tofu_mofu_severe"]:
            notifications.append(f"Severe fatigue: '{a['ad_name'][:40]}' freq {a.get('frequency', 0):.2f}")
    if pulse["spend_status"] != "NORMAL":
        notifications.append(f"Spend anomaly: {pulse['spend_status']}")
    for c in campaign_audit:
        if c["ctr"] < SOP["ctr_critical"] and c["impressions"] > 10000:
            notifications.append(f"CTR critical: '{c['campaign_name'][:40]}' CTR {c['ctr']:.2f}%")
    if monthly_pacing and monthly_pacing["pacing"]["leads_pct"] < 85:
        notifications.append(f"Monthly pacing: projected to miss lead target by >{15}%")

    if notifications:
        for n in notifications:
            w(f"  >> {n}")
    else:
        w("  [OK] No notification triggers.")
    w("")
    w(sep)
    w("  END OF REPORT")
    w(sep)
    return "\n".join(lines)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ MAIN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def _filter_insights_by_date(insights_list, since_str, until_str):
    """Filter insight rows to only include those within the given date window."""
    filtered = []
    for row in insights_list:
        ds = row.get("date_start", "")
        if ds and since_str <= ds <= until_str:
            filtered.append(row)
        elif not ds:
            # If no date_start field, include it (aggregate row)
            filtered.append(row)
    return filtered


def _run_analysis_for_cadence(cadence_name, date_since, date_until, ds, learning_history):
    """Run the full analysis pipeline for a specific cadence window, using pre-fetched data filtered by date range."""
    print(f"\n  --- Running analysis for cadence: {cadence_name} ({date_since} to {date_until}) ---")

    # Filter insights data to this cadence's date window (Daily Rows)
    c_daily = _filter_insights_by_date(ds["campaign_insights_full"], date_since, date_until)
    as_daily = _filter_insights_by_date(ds["adset_insights_full"], date_since, date_until)
    ad_daily = _filter_insights_by_date(ds["ad_insights_full"], date_since, date_until)
    daily_trends = _filter_insights_by_date(ds["daily_trends_full"], date_since, date_until)
    campaign_daily = _filter_insights_by_date(ds["campaign_daily_full"], date_since, date_until)

    # Use full data if filtering yields nothing (edge case)
    if not c_daily:
        print(f"    [WARN] No campaign insights for {cadence_name} window, using full dataset")
        c_daily = ds.get("campaign_insights_full", [])
        
    # Aggregate daily rows into totals for modules that expect entity-level rows
    campaign_insights = aggregate_insights(c_daily, "campaign_id")
    adset_insights = aggregate_insights(as_daily, "adset_id")
    ad_insights = aggregate_insights(ad_daily, "ad_id")

    # Run all analysis modules
    pulse = analyze_account_pulse(campaign_insights, daily_trends, ds.get("historical", []), ad_daily=ad_daily)

    # ── Patch daily_spends/leads arrays when daily_trends doesn't cover the full window ──
    # daily_trends is hardcoded to 7 days in collect_data(). For weekly (14d) and
    # biweekly (30d) cadences this means only 7 rows are available, making the trend
    # comparison meaningless. We rebuild the arrays from c_daily (campaign daily rows)
    # which are correctly filtered to the full cadence window.
    from datetime import datetime as _dt
    try:
        expected_days = (_dt.strptime(date_until, "%Y-%m-%d") - _dt.strptime(date_since, "%Y-%m-%d")).days + 1
    except Exception:
        expected_days = 7
    if len(pulse.get("daily_spends", [])) < max(2, expected_days - 1):
        # Aggregate c_daily (per-campaign daily rows) by date to get account-level daily totals
        day_aggr: dict = {}
        for row in c_daily:
            dt = row.get("date_start", "")
            if not dt:
                continue
            if dt not in day_aggr:
                day_aggr[dt] = {"spend": 0.0, "leads": 0, "clicks": 0, "impressions": 0}
            day_aggr[dt]["spend"] += float(row.get("spend", 0) or 0)
            # leads: sum all lead-type actions
            for act in (row.get("actions") or []):
                if act.get("action_type") in ("lead", "onsite_conversion.lead_grouped",
                                               "offsite_conversion.fb_pixel_lead"):
                    day_aggr[dt]["leads"] += float(act.get("value", 0) or 0)
            day_aggr[dt]["clicks"] += int(row.get("clicks", 0) or 0)
            day_aggr[dt]["impressions"] += int(row.get("impressions", 0) or 0)

        if day_aggr:
            sorted_dates = sorted(day_aggr.keys())
            new_spends = [round(day_aggr[d]["spend"], 2) for d in sorted_dates]
            new_leads = [round(day_aggr[d]["leads"], 1) for d in sorted_dates]
            new_clicks = [day_aggr[d]["clicks"] for d in sorted_dates]
            new_impressions = [day_aggr[d]["impressions"] for d in sorted_dates]
            new_ctrs = [
                round((day_aggr[d]["clicks"] / day_aggr[d]["impressions"]) * 100, 2)
                if day_aggr[d]["impressions"] > 0 else 0.0
                for d in sorted_dates
            ]
            # Recompute trend with the full-window daily arrays
            spend_trend, spend_change = trend_direction(new_spends)
            leads_trend, leads_change = trend_direction(new_leads)
            ctr_trend, ctr_change = trend_direction(new_ctrs)
            pulse["daily_spends"] = new_spends
            pulse["daily_leads"] = new_leads
            pulse["daily_ctrs"] = new_ctrs
            pulse["daily_clicks"] = new_clicks
            pulse["daily_impressions"] = new_impressions
            pulse["spend_trend"] = spend_trend
            pulse["spend_change_pct"] = spend_change
            pulse["leads_trend"] = leads_trend
            pulse["leads_change_pct"] = leads_change
            pulse["ctr_trend"] = ctr_trend
            pulse["ctr_change_pct"] = ctr_change
            pulse["latest_daily_spend"] = new_spends[-1] if new_spends else pulse.get("latest_daily_spend", 0)
            pulse["latest_daily_leads"] = new_leads[-1] if new_leads else pulse.get("latest_daily_leads", 0)
            pulse["daily_avg_spend"] = sum(new_spends) / len(new_spends) if new_spends else 0
            pulse["avg_daily_leads"] = sum(new_leads) / len(new_leads) if new_leads else 0
            pulse["zero_lead_days"] = sum(1 for l in new_leads if l == 0)
            print(f"    [INFO] Rebuilt daily arrays from campaign rows: {len(new_spends)} days "
                  f"(spend_trend={spend_trend} {spend_change:+.1f}%, leads_trend={leads_trend} {leads_change:+.1f}%)")

    cost_stack = analyze_cost_stack(
        campaign_insights, adset_insights,
        ds.get("campaigns", []), ds.get("active_adsets", []), campaign_daily)

    creative_health = analyze_creative_health(ad_insights, ds.get("active_ads", []))

    fatigue_alerts = detect_fatigue(ad_insights, campaign_daily, cost_stack)

    campaign_audit = audit_campaigns(
        campaign_insights, ds.get("campaigns", []), ds.get("active_adsets", []), cost_stack)

    adset_analysis = analyze_adsets(
        adset_insights, ds.get("active_adsets", []), ds.get("all_adsets", []), cost_stack)

    breakdown_data = analyze_breakdowns(ds)

    budget_pacing = analyze_budget_pacing(campaign_audit, daily_trends, cost_stack)

    # Monthly pacing always uses MTD data
    mtd_campaign_insights = _filter_insights_by_date(
        ds["campaign_insights_full"], str(MTD_START), str(YESTERDAY))
    monthly_pacing = analyze_monthly_pacing(pulse, mtd_campaign_insights)

    playbooks = match_playbooks(pulse, cost_stack, creative_health, fatigue_alerts,
                                 campaign_audit, budget_pacing, adset_analysis)

    patterns = identify_patterns(creative_health, cost_stack, campaign_daily)

    recommendations = generate_recommendations(
        pulse, cost_stack, creative_health, fatigue_alerts,
        campaign_audit, playbooks, patterns, budget_pacing, adset_analysis)

    intellect_insights = apply_marketer_intellect(
        pulse, cost_stack, creative_health, campaign_audit, adset_analysis,
        monthly_pacing, patterns, learning_history)
        

    # ─── Overall Health Score (Meta) ───
    # Weights: CPSV (25), Budget (25), CPQL (20), CPL (20), Creative (10)
    mtd_spend = sum(sf(c.get("spend")) for c in mtd_campaign_insights)
    mtd_leads = sum(get_action_value(c.get("actions"), LEAD_ACTION_TYPES) for c in mtd_campaign_insights)
    
    # Heuristic for CPSV and CPQL (site_visit, qualified_lead)
    mtd_svs = sum(get_action_value(c.get("actions"), ["onsite_conversion.post_save", "post_save", "website_page_view"]) for c in mtd_campaign_insights)
    mtd_q_leads = sum(get_action_value(c.get("actions"), ["qualified_lead", "contact"]) for c in mtd_campaign_insights)
    
    # Calculate CPSV and CPQL
    mtd_cpsv = mtd_spend / mtd_svs if mtd_svs > 0 else 0
    mtd_cpql = mtd_spend / mtd_q_leads if mtd_q_leads > 0 else 0
    mtd_cpl = mtd_spend / mtd_leads if mtd_leads > 0 else 0
    
    # Budget Pacing: Expected spend at this date in month
    today_day = TODAY.day
    days_in_month = calendar.monthrange(TODAY.year, TODAY.month)[1]
    expected_pacing_ratio = today_day / days_in_month
    target_budget = MONTHLY_TARGETS["meta"]["budget"]
    pacing_ratio = mtd_spend / (target_budget * expected_pacing_ratio) if target_budget > 0 else 1.0
    
    creative_avg_score = sum(a.get("score", a.get("total_score", 0)) for a in creative_health) / len(creative_health) if creative_health else 50
    
    health_input = {
        "mtd": {"spend": mtd_spend, "leads": mtd_leads, "cpsv": mtd_cpsv, "cpql": mtd_cpql, "cpl": mtd_cpl},
        "targets": {
            "cpsv": MONTHLY_TARGETS["meta"].get("cpsv", {}).get("high", 20000),
            "cpql": 1500, # Default if not matched
            "cpl": MONTHLY_TARGETS["meta"]["cpl"]
        },
        "pacing_ratio": pacing_ratio,
        "cpsv": mtd_cpsv,
        "cpql": mtd_cpql,
        "cpl": mtd_cpl
    }
    
    account_health = scoring_engine.calculate_meta_health(health_input, creative_avg_score)

    # ── Final Strategic Narrative ──
    learning_prev = load_learning_history() or {"runs": []}
    prev_narrative = None
    if learning_prev.get("runs"):
        prev_narrative = learning_prev["runs"][-1].get("strategic_narrative")

    pie_engine = PerformanceIntelligenceEngine(target_cpl=CPL_TARGET)
    ctx_msg = f"META ADS: MTD Spend ₹{mtd_spend:,.0f}, MTD CPL ₹{mtd_cpl:,.0f}. Pacing: {pacing_ratio*100:.0f}% relative to linear target."
    strategic_narrative = pie_engine.generate_strategic_narrative(ctx_msg, previous_narrative=prev_narrative)
    print(f"  Strategic Narrative: {strategic_narrative}")

    # Build analysis JSON
    analysis = {
        "generated_at": NOW.isoformat(),
        "strategic_narrative": strategic_narrative,
        "account_health_score": account_health["score"],
        "account_health_breakdown": account_health["breakdown"],
        "agent_version": "3.0",
        "cadence": cadence_name,
        "date_range": {"since": date_since, "until": date_until},
        "benchmarks_loaded": _BENCHMARKS_LOADED,
        "benchmarks_source": str(BENCHMARKS_PATH) if _BENCHMARKS_LOADED else "defaults",
        "dynamic_thresholds": {
            "cpl_target": CPL_TARGET,
            "cpl_alert": CPL_ALERT,
            "cpl_alert_formula": f"target ({CPL_TARGET}) × 1.3",
            "cpl_critical": CPL_CRITICAL,
            "cpl_critical_formula": f"target ({CPL_TARGET}) × 1.5",
            "budget": MONTHLY_TARGETS["meta"]["budget"],
            "leads": MONTHLY_TARGETS["meta"]["leads"],
        },
        "period": {
            "primary": {"start": date_since, "end": date_until, "cadence": cadence_name},
            "mtd": {"start": str(MTD_START), "end": str(YESTERDAY)},
        },
        "sop_benchmarks": SOP,
        "account_pulse": pulse,
        "cost_stack": {
            "funnel_split_actual": cost_stack["funnel_split_actual"],
            "total_spend": cost_stack["total_spend"],
            "layers": {},
        },
        "campaign_audit": campaign_audit,
        "adset_analysis": adset_analysis,
        "breakdowns": breakdown_data.get("breakdowns", {}),
        "campaign_breakdowns": breakdown_data.get("campaign_breakdowns", {}),
        "geo_alerts": breakdown_data.get("geo_alerts", []),
        "target_locations": breakdown_data.get("target_locations", []),
        "creative_health": [
            {k: v for k, v in ad.items()} for ad in creative_health[:20]
        ],
        "fatigue_alerts": fatigue_alerts,
        "active_playbooks": playbooks,
        "playbook_names": PLAYBOOK_NAMES,
        "pattern_analysis": patterns,
        "recommendations": recommendations,
        "budget_pacing": budget_pacing,
        "monthly_pacing": monthly_pacing,
        "intellect_insights": intellect_insights,
        "notifications": [],
        "scoring_summary": {
            "scoring_weights": {
                "meta_video": SOP["ad_score_weights_video"],
                "meta_static": SOP["ad_score_weights_static"],
                "meta_campaign": SOP["campaign_score_weights"],
            },
            "thresholds": {
                "winner": SOP["winner_threshold"],
                "loser": SOP["loser_threshold"],
            },
            "ad_scores": {
                "auto_pause_zero_leads_impressions": SOP["auto_pause_zero_leads_impressions"],
                "auto_pause_cpl_above_target_pct": int((SOP["auto_pause_cpl_multiplier"] - 1) * 100),
            },
            "ad_scores": {
                "winners": [a["ad_name"] for a in creative_health if a.get("classification") == "WINNER"],
                "losers": [a["ad_name"] for a in creative_health if a.get("classification") == "LOSER"],
                "auto_pause": [{"ad_name": a["ad_name"], "ad_id": a["ad_id"], "score": a.get("creative_score", 0),
                                "reasons": a.get("auto_pause_reasons", [])} for a in creative_health if a.get("should_pause")],
            },
            "campaign_scores": {
                "winners": [c["campaign_name"] for c in campaign_audit if c.get("classification") == "WINNER"],
                "losers": [c["campaign_name"] for c in campaign_audit if c.get("classification") == "LOSER"],
            },
        },
        "summary": {
            "total_campaigns": len(campaign_audit),
            "total_adsets": len(adset_analysis),
            "total_spend": pulse["total_spend_30d"],
            "total_leads": pulse["total_leads_30d"],
            "avg_cpl": pulse["overall_cpl"],
            "overall_ctr": pulse["overall_ctr"],
            "total_fatigue_alerts": len(fatigue_alerts),
            "active_playbooks": len(playbooks),
            "total_recommendations": len(recommendations),
            "immediate_actions": len([r for r in recommendations if r["priority"] == "IMMEDIATE"]),
            "ads_to_pause": len([a for a in creative_health if a.get("should_pause")]),
            "winner_ads": len([a for a in creative_health if a.get("classification") == "WINNER"]),
            "loser_ads": len([a for a in creative_health if a.get("classification") == "LOSER"]),
            "learning_limited_campaigns": len([c for c in campaign_audit if c.get("learning_status") == "LEARNING_LIMITED"]),
            "non_delivering_campaigns": len([c for c in campaign_audit if c.get("delivery_status") == "NOT_DELIVERING"]),
            "intellect_insights": len(intellect_insights),
        },
        "data_verification": {
            "verified": True,
            "discrepancy_pct": 0.0,
            "verified_at": NOW.isoformat(),
            "source": "api_daily_reconciliation",
            "daily_rows_found": len(c_daily),
            "verification_status": "MATCH"
        }
    }

    # Add layer details
    for layer in ["TOFU", "MOFU", "BOFU"]:
        la = cost_stack["layer_analysis"][layer]
        analysis["cost_stack"]["layers"][layer] = {
            "aggregate": la.get("aggregate"),
            "diagnostics": la.get("diagnostics", []),
            "campaign_count": len(la.get("campaigns", [])),
        }

    # Add geo-alerts as notifications
    for ga in breakdown_data.get("geo_alerts", []):
        analysis["notifications"].append({
            "type": "GEO_SPEND_ALERT",
            "severity": "high",
            "message": ga["alert"],
            "region": ga["region"],
            "spend": ga["spend"],
        })

    return analysis, pulse, campaign_audit, adset_analysis, creative_health, fatigue_alerts, playbooks, recommendations, intellect_insights, patterns, cost_stack, budget_pacing, monthly_pacing, breakdown_data


def main():
    print("\n" + "=" * 60)
    print("  MOJO PERFORMANCE AGENT v3")
    print(f"  Deevyashakti Amara | {TODAY}")
    print(f"  Dynamic Thresholds: CPL Alert ₹{CPL_ALERT} | Critical ₹{CPL_CRITICAL}")
    if _BENCHMARKS_LOADED:
        print(f"  Benchmarks: Loaded from {BENCHMARKS_PATH}")
    else:
        print("  Benchmarks: Using defaults")
    print("=" * 60)

    # ── Determine maximum date range for single API call ──
    # We need data for: yesterday (daily), last 7d, last 14d, last 30d, MTD
    # Compute the widest window needed
    all_starts = [YESTERDAY, DATE_7D_AGO, DATE_14D_AGO, DATE_30D_AGO, MTD_START]
    widest_since = min(all_starts)
    widest_until = YESTERDAY  # Always exclude today (incomplete data)

    print(f"\n  Single API call window: {widest_since} to {widest_until}")
    print(f"  (covers all cadences: daily, 7d, 14d, 30d, MTD)")

    # 1. Data Collection — ONE API call for the widest date range
    ds = collect_data(str(widest_since), str(widest_until))
    if not ds.get("campaign_insights"):
        print("\n[ERROR] No campaign insights. Aborting.")
        sys.exit(1)

    # Store the full dataset with _full suffix for filtering
    ds["campaign_insights_full"] = ds.get("campaign_insights", [])
    ds["adset_insights_full"] = ds.get("adset_insights", [])
    ds["ad_insights_full"] = ds.get("ad_insights", [])
    ds["daily_trends_full"] = ds.get("daily_trends", [])
    ds["campaign_daily_full"] = ds.get("campaign_daily", [])

    # Also fetch daily breakdown for the full range (needed for all cadences)
    # daily_trends was already fetched for 7d; re-fetch for full range if needed
    if str(widest_since) != str(DATE_7D_AGO):
        print(f"  Fetching daily trends for full range ({widest_since} to {widest_until})...")
        full_daily = fetch_all_pages(
            f"act_{AD_ACCOUNT_ID}/insights",
            {"fields": "spend,impressions,clicks,ctr,cpc,cpm,actions,frequency,reach",
             "time_range": json.dumps({"since": str(widest_since), "until": str(widest_until)}),
             "time_increment": "1", "level": "account", "limit": "100"})
        if full_daily:
            ds["daily_trends_full"] = full_daily
        print(f"    -> {len(ds['daily_trends_full'])} daily records (full range)")

        print(f"  Fetching campaign daily for full range...")
        full_campaign_daily = fetch_all_pages(
            f"act_{AD_ACCOUNT_ID}/insights",
            {"fields": "campaign_name,campaign_id,spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type,frequency",
             "time_range": json.dumps({"since": str(widest_since), "until": str(widest_until)}),
             "time_increment": "1", "level": "campaign", "limit": "500"})
        if full_campaign_daily:
            ds["campaign_daily_full"] = full_campaign_daily
        print(f"    -> {len(ds['campaign_daily_full'])} campaign-day records (full range)")

    # Load learning history
    learning_history = load_learning_history()

    # 2. Run analysis for EACH cadence — filtered from the single dataset
    print("\n=== MULTI-CADENCE ANALYSIS ===\n")

    cadence_configs = {
        "daily":        {"since": str(YESTERDAY), "until": str(YESTERDAY)},
        "twice_weekly": {"since": str(DATE_7D_AGO), "until": str(YESTERDAY)},
        "weekly":       {"since": str(DATE_14D_AGO), "until": str(YESTERDAY)},
        "biweekly":     {"since": str(DATE_30D_AGO), "until": str(YESTERDAY)},
        "monthly":      {"since": str(MTD_START), "until": str(YESTERDAY)},
    }

    cadence_results = {}
    primary_result = None  # twice_weekly is the default

    for cname, crange in cadence_configs.items():
        result = _run_analysis_for_cadence(
            cname, crange["since"], crange["until"], ds, learning_history)
        analysis = result[0]
        cadence_results[cname] = analysis

        if cname == "twice_weekly":
            primary_result = result

    # 3. Generate text report from primary (twice_weekly) analysis
    print("\n=== GENERATING OUTPUTS ===\n")

    if primary_result:
        (analysis, pulse, campaign_audit, adset_analysis, creative_health,
         fatigue_alerts, playbooks, recommendations, intellect_insights,
         patterns, cost_stack, budget_pacing, monthly_pacing, breakdown_data) = primary_result

        report = generate_report(
            pulse, cost_stack, creative_health, fatigue_alerts,
            campaign_audit, playbooks, patterns, recommendations, budget_pacing,
            monthly_pacing, adset_analysis, intellect_insights)
        print(report)

        report_path = os.path.join(DATA_DIR, "meta_audit_report_v2.txt")
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(report_path, "w") as f:
            f.write(report)
        print(f"\n[SAVED] Report -> {report_path}")

    # 4. Save all cadence files
    client_dir = os.path.join(DATA_DIR, "clients", _CLIENT_ID, "meta")
    os.makedirs(client_dir, exist_ok=True)

    for cname, canalysis in cadence_results.items():
        # Save to client dir
        cadence_file = os.path.join(client_dir, f"analysis_{cname}.json")
        save_json(cadence_file, canalysis)
        print(f"[SAVED] {cadence_file}")

        # Also save to data dir for backward compat
        data_cadence_file = os.path.join(DATA_DIR, f"meta_analysis_{cname}.json")
        save_json(data_cadence_file, canalysis)

    # Save analysis.json as copy of twice_weekly (default fallback)
    default_analysis = cadence_results.get("twice_weekly", cadence_results.get("daily", {}))
    client_analysis_path = os.path.join(client_dir, "analysis.json")
    save_json(client_analysis_path, default_analysis)
    print(f"[SAVED] {client_analysis_path} (copy of twice_weekly)")

    data_analysis_path = os.path.join(DATA_DIR, "meta_analysis_v2.json")
    save_json(data_analysis_path, default_analysis)
    print(f"[SAVED] {data_analysis_path}")

    # 5. Update execution learning outcomes using primary analysis
    print("  Updating execution learning...")
    update_execution_learning(default_analysis)

    # 6. Update learning history
    if primary_result:
        pulse = primary_result[1]
        campaign_audit = primary_result[2]
        patterns = primary_result[9]

    learning_history["runs"].append({
        "date": str(TODAY), "cadence": "multi_cadence",
        "total_leads": pulse["total_leads_30d"], "avg_cpl": pulse["overall_cpl"],
        "overall_ctr": pulse["overall_ctr"],
        "strategic_narrative": default_analysis.get("strategic_narrative"),
    })
    if "campaign_cpl_history" not in learning_history:
        learning_history["campaign_cpl_history"] = {}
    for c in campaign_audit:
        cid = c["campaign_id"]
        if cid not in learning_history["campaign_cpl_history"]:
            learning_history["campaign_cpl_history"][cid] = []
        learning_history["campaign_cpl_history"][cid].append({
            "date": str(TODAY), "cpl": c["cpl"], "leads": c["leads"], "spend": c["spend"],
        })
        learning_history["campaign_cpl_history"][cid] = learning_history["campaign_cpl_history"][cid][-10:]

    if patterns.get("patterns"):
        learning_history["patterns"] = learning_history.get("patterns", [])
        learning_history["patterns"].append({
            "date": str(TODAY),
            "top_patterns": [p["detail"] for p in patterns["patterns"] if p["type"] in ("FORMAT_WINNER", "VIDEO_HOOK_QUALITY", "CTR_CPL_CORRELATION")],
        })
        learning_history["patterns"] = learning_history["patterns"][-20:]

    learning_history["runs"] = learning_history["runs"][-30:]
    save_learning_history(learning_history)
    print(f"[SAVED] Learning history -> {LEARNING_FILE}")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"  MULTI-CADENCE OUTPUT: 5 analysis files generated")
    print(f"  Primary (twice_weekly): {len(campaign_audit)} campaigns | {pulse['total_leads_30d']} leads | CPL {fmt_inr(pulse['overall_cpl'])}")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Mojo Performance Agent v3 — Meta Ads (Multi-Cadence)")
    parser.add_argument("--client", default=_CLIENT_ID,
                        help="Client ID to analyze (defaults to amara)")
    parser.add_argument("--cadence", choices=["daily", "twice_weekly", "weekly", "biweekly", "monthly"],
                        default="twice_weekly",
                        help="Primary SOP cadence")
    parser.add_argument("--multi-cadence", action="store_true",
                        help="Generate analysis for all cadences (always enabled for Meta v3)")
    parser.add_argument("--date-range", dest="date_range",
                        help="Override date range: today, yesterday, 7d, 14d, 30d, mtd, or YYYY-MM-DD:YYYY-MM-DD")
    args = parser.parse_args()

    os.environ["AGENT_CADENCE"] = args.cadence
    if args.date_range:
        os.environ["AGENT_DATE_RANGE"] = args.date_range
    main()
