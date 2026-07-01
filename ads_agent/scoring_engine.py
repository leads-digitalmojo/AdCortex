import math

def safe_div(a, b):
    return a / b if b > 0 else 0

def get_band_from_score(score_100):
    """Unified banding logic: 0-100 normalized score to qualitative band."""
    if score_100 >= 85: return "excellent"
    if score_100 >= 70: return "good"
    if score_100 >= 40: return "watch"
    return "poor"

def score_linear(actual, target, weight, lower_is_better=True):
    """
    Standard linear scoring: 
    If actual == target, score = weight
    Normalized score (0-100) is used to determine the band.
    """
    if target <= 0:
        return weight * 0.5, "no_data"
    
    if lower_is_better:
        if actual <= target * 0.8:
            return weight, "excellent"
        if actual >= target * 1.5:
            return 0, "poor"
        # Linear interp between 1.5 and 0.8
        ratio = actual / target
        score_ratio = (1.5 - ratio) / (1.5 - 0.8)
        score_ratio = max(0, min(1, score_ratio))
        score_100 = score_ratio * 100
        return round(weight * score_ratio, 2), get_band_from_score(score_100)
    else:
        if actual >= target * 1.2:
            return weight, "excellent"
        if actual <= target * 0.5:
            return 0, "poor"
        # Linear interp between 0.5 and 1.2
        ratio = actual / target
        score_ratio = (ratio - 0.5) / (1.2 - 0.5)
        score_ratio = max(0, min(1, score_ratio))
        score_100 = score_ratio * 100
        return round(weight * score_ratio, 2), get_band_from_score(score_100)

def score_impression_share(actual_is, target_is):
    """
    Google graded IS scoring:
    ≥ Target -> 100% score
    70% of target -> 75% score
    50% of target -> 40% score
    <50% of target -> 10% score
    """
    if target_is <= 0:
        return 50  # Default
    
    ratio = actual_is / target_is
    if ratio >= 1.0:
        return 100
    if ratio >= 0.7:
        # Interpolate between 75% and 100%
        return 75 + (ratio - 0.7) / (1.0 - 0.7) * 25
    if ratio >= 0.5:
        # Interpolate between 40% and 75%
        return 40 + (ratio - 0.5) / (0.7 - 0.5) * 35
    # Interpolate between 10% and 40%
    return max(10, 10 + (ratio / 0.5) * 30)

def normalize_score(score_map, total_weight=100):
    total = sum(score_map.values())
    if total_weight != 100:
        total = (total / total_weight) * 100
    return round(max(0, min(100, total)), 1)

def score_staged_cost(actual, target, weight):
    """
    Staged scoring for CPSV, CPQL, CPL:
    - On target (up to +10%): 100
    - +10% to +20%: 70
    - +20% to +30%: 40
    - 30% or above: 10
    """
    if target <= 0: return weight * 0.5, "no_data"
    ratio = actual / target
    if ratio <= 1.1:
        score_100 = 100
        band = "good"
    elif ratio <= 1.2:
        score_100 = 70
        band = "watch"
    elif ratio <= 1.3:
        score_100 = 40
        band = "watch"
    else:
        score_100 = 10
        band = "poor"
    return round(weight * (score_100 / 100), 2), band

def score_staged_budget(pacing_ratio, weight):
    """
    Staged scoring for Budget:
    - ±10%: 100
    - ±15%: 60
    - >15%: 20
    """
    dev = abs(pacing_ratio - 1.0)
    if dev <= 0.10:
        score_100 = 100
        band = "good"
    elif dev <= 0.15:
        score_100 = 60
        band = "watch"
    else:
        score_100 = 20
        band = "poor"
    return round(weight * (score_100 / 100), 2), band

def get_interpretation(score, data=None, target_cpl=None):
    """
    Grading System:
    WINNER: Health ≥ 75, CPL ≤ target
    WATCH: Health 50–74
    UNDERPERFORMER: Health < 50 OR CPL > 1.3× target
    """
    cpl = data.get("cpl", 0) if data else 0
    
    # Primary classification logic
    if score >= 75 and (target_cpl is None or cpl <= target_cpl):
        return "WINNER", "green"
    
    if score < 50 or (target_cpl is not None and target_cpl > 0 and cpl > target_cpl * 1.3):
        return "UNDERPERFORMER", "red"
        
    return "WATCH", "yellow"

# --- Overall Health Functions ---

def calculate_meta_health(mtd_data, creative_avg):
    """
    Meta: CPSV (25), Budget (25), CPQL (20), CPL (20), Creative (10)
    """
    w = {"cpsv": 25, "budget": 25, "cpql": 20, "cpl": 20, "creative": 10}
    breakdown = {}
    bands = {}
    
    t = mtd_data.get("targets", {})
    
    breakdown["cpsv"], _ = score_staged_cost(mtd_data.get("cpsv", 0), t.get("cpsv", 20000), 100)
    
    # Budget pacing score: staged deviation
    pacing_ratio = mtd_data.get("pacing_ratio", 1.0)
    breakdown["budget"], _ = score_staged_budget(pacing_ratio, 100)
    
    breakdown["cpql"], bands["cpql"] = score_staged_cost(mtd_data.get("cpql", 0), t.get("cpql", 1500), 100)
    breakdown["cpl"], bands["cpl"] = score_staged_cost(mtd_data.get("cpl", 0), t.get("cpl", 850), 100)
    breakdown["creative"] = round(creative_avg, 2)
    bands["creative"] = get_band_from_score(creative_avg)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    
    # Return both normalized score and weighted contribution
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "bands": bands, "detailed_breakdown": detailed_breakdown}

def calculate_google_health(mtd_data, campaign_avg, creative_avg):
    """
    Google: CPSV (25), Budget (20), CPQL (20), CPL (10), Campaign (15), Creative (10)
    """
    w = {"cpsv": 25, "budget": 20, "cpql": 20, "cpl": 10, "campaign": 15, "creative": 10}
    breakdown = {}
    
    t = mtd_data.get("targets", {})
    
    breakdown["cpsv"], _ = score_staged_cost(mtd_data.get("cpsv", 0), t.get("cpsv", 20000), 100)
    
    pacing_ratio = mtd_data.get("pacing_ratio", 1.0)
    breakdown["budget"], _ = score_staged_budget(pacing_ratio, 100)
    
    breakdown["cpql"], _ = score_staged_cost(mtd_data.get("cpql", 0), t.get("cpql", 1500), 100)
    breakdown["cpl"], _ = score_staged_cost(mtd_data.get("cpl", 0), t.get("cpl", 850), 100)
    breakdown["campaign"] = round(campaign_avg, 2)
    breakdown["creative"] = round(creative_avg, 2)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "detailed_breakdown": detailed_breakdown}

# --- Module Specific Scorers ---

def score_meta_campaign_module(data, target_cpl):
    """
    Recalibrated Meta Campaign: 
    - CPL (25), CVR (15), CTR (15), Leads (15) -> 70% Results focus
    - Freq (10), CPM (10), Budget (10) -> 30% Efficiency focus
    """
    w = {"cpl": 25, "cvr": 15, "ctr": 15, "leads": 15, "freq": 10, "cpm": 10, "budget": 10}
    breakdown = {}
    bands = {}
    
    breakdown["cpl"], bands["cpl"] = score_staged_cost(data.get("cpl", 0), target_cpl, 100)
    breakdown["cvr"], bands["cvr"] = score_linear(data.get("cvr", 0), 1.5, 100, False) # Relaxed real-estate CVR target
    breakdown["ctr"], bands["ctr"] = score_linear(data.get("ctr", 0), 0.45, 100, False) # Relaxed real-estate CTR target
    
    # Lead volume vs expected (spend / target_cpl)
    expected_leads = data.get("spend", 0) / target_cpl if target_cpl > 0 else 0
    leads = data.get("leads", 0)
    lead_score = round(100 * min(1.2, safe_div(leads, expected_leads)), 2) if expected_leads > 0 else 50
    breakdown["leads"] = min(100, lead_score)
    bands["leads"] = get_band_from_score(breakdown["leads"])
    
    breakdown["freq"], bands["freq"] = score_linear(data.get("frequency", 0), 1.8, 100, True)
    breakdown["cpm"], bands["cpm"] = score_linear(data.get("cpm", 0), 350, 100, True) # Relaxed CPM target
    
    util = data.get("budget_utilization", 100)
    breakdown["budget"], bands["budget"] = score_staged_budget(util / 100, 100)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    
    # --- RED FLAG OVERRIDE ---
    if bands["cvr"] == "poor" or bands["cpl"] == "poor":
        total_score = min(total_score, 65.0)
        
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "bands": bands, "detailed_breakdown": detailed_breakdown}

def score_meta_creative_module(data, target_cpl):
    is_video = data.get("is_video", False)
    breakdown = {}
    if is_video:
        # Meta Video: CPL (35), CPM (20), TSR (15), VHR (15), CTR (15)
        w = {"cpl": 35, "cpm": 20, "tsr": 15, "vhr": 15, "ctr": 15}
        breakdown["cpl"], _ = score_staged_cost(data.get("cpl", 0), target_cpl, 100)
        breakdown["cpm"], _ = score_linear(data.get("cpm", 0), 200, 100, True)
        breakdown["tsr"], _ = score_linear(data.get("thumb_stop_pct", 0), 25, 100, False)
        breakdown["vhr"], _ = score_linear(data.get("hold_rate_pct", 0), 25, 100, False)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, 100, False)
    else:
        # Meta Static: CPL (45), CPM (25), CTR (20), CPC (10)
        w = {"cpl": 45, "cpm": 25, "ctr": 20, "cpc": 10}
        breakdown["cpl"], _ = score_staged_cost(data.get("cpl", 0), target_cpl, 100)
        breakdown["cpm"], _ = score_linear(data.get("cpm", 0), 150, 100, True)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.6, 100, False)
        breakdown["cpc"], _ = score_staged_cost(data.get("avg_cpc", 0), 40, 100)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "detailed_breakdown": detailed_breakdown}

def score_google_campaign_module(data, target_cpl):
    """
    Google Search Campaign: CPL (30), CVR (22), CPC (15), QS (13), CTR (10), IS (5), RSA (5)
    """
    w = {"cpl": 30, "cvr": 22, "cpc": 15, "qs": 13, "ctr": 10, "is": 5, "rsa": 5}
    breakdown = {}
    
    breakdown["cpl"], _ = score_staged_cost(data.get("cpl", 0), target_cpl, 100)
    breakdown["cvr"], _ = score_linear(data.get("cvr", 0), 5.0, 100, False) # Search Target 5%
    breakdown["cpc"], _ = score_staged_cost(data.get("avg_cpc", 0), 30, 100)
    
    qs_raw = data.get("quality_score", 5)
    breakdown["qs"] = round(qs_raw / 10 * 100, 2)
    
    breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, 100, False)
    
    # Impression Share
    ctype = data.get("campaign_type", "location")
    is_targets = {"branded": 85, "location": 60, "generic": 50, "competitor": 40}
    found_type = "location"
    for k in is_targets:
        if k in ctype.lower():
            found_type = k
            break
    is_target = is_targets[found_type]
    breakdown["is"] = round(score_impression_share(data.get("impression_share", 0), is_target), 2)
    
    breakdown["rsa"] = round(data.get("rsa_count", 0) / 3 * 100, 2)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "detailed_breakdown": detailed_breakdown}

def score_google_adgroup_module(data, target_cpl):
    """
    Google Search Ad Group: CPL (30), CVR (25), CTR (15), QS (15), IS (10), CPC (5)
    """
    w = {"cpl": 30, "cvr": 25, "ctr": 15, "qs": 15, "is": 10, "cpc": 5}
    breakdown = {}
    
    breakdown["cpl"], _ = score_staged_cost(data.get("cpl", 0), target_cpl, 100)
    breakdown["cvr"], _ = score_linear(data.get("cvr", 0), 5.0, 100, False)
    breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, 100, False)
    breakdown["qs"] = round(data.get("quality_score", 5) / 10 * 100, 2)
    
    ctype = data.get("campaign_type", "location")
    is_targets = {"branded": 85, "location": 60, "generic": 50, "competitor": 40}
    is_target = is_targets.get(ctype.lower(), 60)
    breakdown["is"] = round(score_impression_share(data.get("impression_share", 0), is_target), 2)
    breakdown["cpc"], _ = score_linear(data.get("avg_cpc", 0), 30, 100, True)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "detailed_breakdown": detailed_breakdown}

def score_google_dg_module(data, target_cpl):
    """
    Google Demand Gen: CPL (30), CPM (20), CVR (15), CTR (15), TSR (10), Freq (10)
    """
    w = {"cpl": 30, "cpm": 20, "cvr": 15, "ctr": 15, "tsr": 10, "freq": 10}
    breakdown = {}
    
    breakdown["cpl"], _ = score_staged_cost(data.get("cpl", 0), target_cpl, 100)
    breakdown["cpm"], _ = score_staged_cost(data.get("avg_cpm", 0), 120, 100)
    breakdown["cvr"], _ = score_linear(data.get("cvr", 0), 3.0, 100, False) # DG target 3%
    breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, 100, False)
    breakdown["tsr"], _ = score_linear(data.get("tsr", 0), 3.5, 100, False)
    breakdown["freq"], _ = score_linear(data.get("frequency", 0), 4.0, 100, True) # DG cap 4
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "detailed_breakdown": detailed_breakdown}

def score_google_rsa_module(data, target_cpl):
    """
    Google RSA: CPL (35), CTR (25), CVR (20), Ad Strength (10), Expected CTR (10)
    """
    w = {"cpl": 35, "ctr": 25, "cvr": 20, "ad_strength": 10, "expected_ctr": 10}
    breakdown = {}
    
    breakdown["cpl"], _ = score_staged_cost(data.get("cpl", 0), target_cpl, 100)
    breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 2.0, 100, False)
    breakdown["cvr"], _ = score_linear(data.get("cvr", 0), 5.0, 100, False)
    
    strength_map = {"EXCELLENT": 1.0, "GOOD": 0.8, "AVERAGE": 0.5, "POOR": 0.2, "LOW": 0.1, "UNSPECIFIED": 0.5}
    strength = data.get("ad_strength", "AVERAGE").upper()
    breakdown["ad_strength"] = round(strength_map.get(strength, 0.5) * 100, 2)
    
    exp_ctr_map = {"ABOVE_AVERAGE": 1.0, "AVERAGE": 0.6, "BELOW_AVERAGE": 0.2, "UNSPECIFIED": 0.5}
    exp_ctr = data.get("expected_ctr", "AVERAGE").upper()
    breakdown["expected_ctr"] = round(exp_ctr_map.get(exp_ctr, 0.5) * 100, 2)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "detailed_breakdown": detailed_breakdown}

def score_google_creative_module(data, target_cpl):
    is_video = "VIDEO" in data.get("type", "").upper() or data.get("is_video", False)
    is_static = not is_video # Simplified
    breakdown = {}
    
    if is_video:
        # Google Video: CPL (35), CPM (20), CTR (15), TSR (15), VHR (15)
        w = {"cpl": 35, "cpm": 20, "ctr": 15, "tsr": 15, "vhr": 15}
        breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
        breakdown["cpm"], _ = score_linear(data.get("avg_cpm", 0), 120, 100, True)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.8, 100, False)
        breakdown["tsr"], _ = score_linear(data.get("tsr", 0), 3.5, 100, False)
        breakdown["vhr"], _ = score_linear(data.get("vhr", 0), 30, 100, False)
    else:
        # Google Static: CPL (45), CPM (25), CTR (20), CPC (10)
        w = {"cpl": 45, "cpm": 25, "ctr": 20, "cpc": 10}
        breakdown["cpl"], _ = score_linear(data.get("cpl", 0), target_cpl, 100, True)
        breakdown["cpm"], _ = score_linear(data.get("avg_cpm", 0), 80, 100, True)
        breakdown["ctr"], _ = score_linear(data.get("ctr", 0), 0.6, 100, False)
        breakdown["cpc"], _ = score_linear(data.get("avg_cpc", 0), 20, 100, True)
    
    total_score = sum((breakdown[k] * w[k] / 100) for k in w)
    detailed_breakdown = {k: {"score": breakdown[k], "weight": w[k], "contribution": round(breakdown[k] * w[k] / 100, 2)} for k in w}
    return {"score": round(max(0, min(100, total_score)), 1), "breakdown": breakdown, "detailed_breakdown": detailed_breakdown}

# --- Quality Score Page Scorer ---

def score_quality_score_page(data):
    """
    Quality Score Page: LP Exp (35), Expected CTR (35), Ad Relevance (30)
    """
    w = {"lp_exp": 35, "exp_ctr": 35, "ad_rel": 30}
    scores = {}
    
    mapping = {"ABOVE_AVERAGE": 1.0, "AVERAGE": 0.6, "BELOW_AVERAGE": 0.2, "UNSPECIFIED": 0.5}
    
    scores["lp_exp"] = round(mapping.get(data.get("landing_page_experience", "AVERAGE").upper(), 0.5) * w["lp_exp"], 2)
    scores["exp_ctr"] = round(mapping.get(data.get("expected_click_through_rate", "AVERAGE").upper(), 0.5) * w["exp_ctr"], 2)
    scores["ad_rel"] = round(mapping.get(data.get("ad_relevance", "AVERAGE").upper(), 0.5) * w["ad_rel"], 2)
    
    return {"score": normalize_score(scores), "breakdown": scores}
