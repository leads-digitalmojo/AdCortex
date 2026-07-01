import datetime
import json
import os
from collections import defaultdict
from urllib.request import urlopen, Request
from urllib.parse import urlencode, quote

def safe_div(a, b):
    return a / b if b > 0 else 0

class PerformanceIntelligenceEngine:
    """
    PIE — Performance Intelligence Engine
    Answers the "WHY" behind performance shifts and integrates LLM reasoning.
    """
    
    def __init__(self, benchmarks=None, target_cpl=800):
        self.benchmarks = benchmarks or {}
        self.target_cpl = target_cpl
        self.groq_api_key = os.environ.get("GROQ_API_KEY")
        self.openai_api_key = os.environ.get("OPENAPI_API_KEY")

    def diagnose_campaign(self, campaign):
        """Perform a deep-dive diagnosis on a single campaign."""
        reasons = []
        cpl = campaign.get("cpl", campaign.get("cost_per_conversion", 0))
        cvr = campaign.get("cvr", 0)
        ctr = campaign.get("ctr", 0)
        cpc = campaign.get("avg_cpc", 0)
        status = campaign.get("status", "ENABLED")
        ctype = campaign.get("campaign_type", "location")
        
        if status != "ENABLED":
            return []

        # 1. CPL Diagnosis
        if cpl > self.target_cpl * 1.3:
            benchmark = self.benchmarks.get("location", {"cvr_low": 3.0, "cpc_high": 40})
            if ctype in self.benchmarks:
                 benchmark = self.benchmarks[ctype]
            
            if cvr < benchmark.get("cvr_low", 3.0):
                reasons.append({
                    "issue": "Conversion Rate Floor",
                    "why": f"CVR ({cvr}%) is below benchmark floor ({benchmark.get('cvr_low')}%)",
                    "impact": "Primary driver of high CPL",
                    "fix": "Audit Landing Page Experience or Audience Intent quality."
                })
            
            if cpc > benchmark.get("cpc_high", 50) if "cpc_high" in benchmark else cpc > 40:
                reasons.append({
                    "issue": "Cost-Per-Click Inflation",
                    "why": f"CPC (₹{cpc:.2f}) is higher than efficient benchmark",
                    "impact": "Increasing cost-basis for every conversion",
                    "fix": "Review bidding caps or negative keyword exclusion."
                })

        # 2. Impression Share Diagnosis (Google Specific)
        is_val = campaign.get("search_impression_share", 0)
        lost_budget = campaign.get("search_budget_lost_is", 0)
        lost_rank = campaign.get("search_rank_lost_is", 0)
        
        if is_val > 0 and is_val < 40:
            if lost_budget > 20:
                reasons.append({
                    "issue": "Budget Constrained IS",
                    "why": f"Lost {lost_budget}% Impression Share to Budget",
                    "impact": "Leaving efficient leads on the table",
                    "fix": "Increase daily budget by 15-20%."
                })
            if lost_rank > 40:
                reasons.append({
                    "issue": "Rank Constrained IS",
                    "why": f"Lost {lost_rank}% Impression Share to Rank/Quality",
                    "impact": "Poor ad visibility despite budget",
                    "fix": "Improve Quality Score or nudge CPC bids."
                })

        return reasons

    def generate_strategic_narrative(self, context_summary, previous_narrative=None):
        """Call LLM (Groq/OpenAI) to generate a 2-sentence strategic executive summary."""
        if not self.groq_api_key and not self.openai_api_key:
            return "Strategic insights unavailable (API Key missing)."

        history_ctx = f"\nPREVIOUS TAKE: {previous_narrative}" if previous_narrative else ""
        
        prompt = f"""You are Mojo, a senior performance marketing strategist. 
Analyse this account summary and provide a 2-sentence 'Mojo's Take' as an executive summary.
{history_ctx}

SUMMARY:
{context_summary}

RULES:
- Be extremely blunt and direct.
- Use marketing jargon (CPL, CVR, ROAS, tCPA, TOFU).
- Highlight the single biggest opportunity or risk.
- Do not use flowery language.
- Format as: 'Mojo's Take: [Insight]. [Action].'"""

        import time

        providers = []
        # OpenAI (Primary as requested by user)
        if self.openai_api_key:
            providers.append({
                "name": "OpenAI",
                "url": "https://api.openai.com/v1/chat/completions",
                "headers": {"Content-Type": "application/json", "Authorization": f"Bearer {self.openai_api_key}"},
                "model": "gpt-4o-mini",
            })
        # Groq (Fallback)
        if self.groq_api_key:
            providers.append({
                "name": "Groq",
                "url": "https://api.groq.com/openai/v1/chat/completions",
                "headers": {"Content-Type": "application/json", "Authorization": f"Bearer {self.groq_api_key}"},
                "model": "llama-3.3-70b-versatile",
            })

        last_error = None
        for provider in providers:
            for attempt in range(2):
                try:
                    print(f"[AI] Attempting analysis using {provider['name']} ({provider['model']})...")
                    body = json.dumps({
                        "model": provider["model"],
                        "messages": [{"role": "system", "content": "You are Mojo, a blunt performance marketing expert."}, {"role": "user", "content": prompt}],
                        "max_tokens": 150
                    })
                    req = Request(provider["url"], data=body.encode(), headers=provider["headers"])
                    with urlopen(req, timeout=30) as resp:
                        data = json.loads(resp.read().decode())
                        result = data["choices"][0]["message"]["content"].strip()
                        print(f"[AI] Analysis successful using {provider['name']}.")
                        return result
                except Exception as e:
                    last_error = e
                    print(f"[AI] Error with {provider['name']}: {str(e)}")
                    if attempt == 0:
                        time.sleep(2)

        return f"Strategic analysis failed: {str(last_error)}"

class PatternDetectionEngine:
    """
    PDE — Pattern Detection Engine
    Uncovers cross-campaign or temporal patterns (Fatigue, Cannibalization, etc.)
    """
    
    def __init__(self, historical_data=None):
        self.historical_data = historical_data or []

    def detect_fatigue(self, campaign, metrics_history):
        """
        Detect creative/audience fatigue.
        Pattern: CTR down 20%+ AND (CPC up 15%+ OR CPM up 15%+) over last 7-14 days.
        """
        if len(metrics_history) < 7:
            return None
            
        last_3 = metrics_history[-3:]
        prev_3 = metrics_history[-7:-4]
        
        avg_ctr_now = safe_div(sum(m.get("ctr", 0) for m in last_3), 3)
        avg_ctr_prev = safe_div(sum(m.get("ctr", 0) for m in prev_3), 3)
        
        avg_cpc_now = safe_div(sum(m.get("spend", 0) for m in last_3), sum(m.get("clicks", 0) for m in last_3))
        avg_cpc_prev = safe_div(sum(m.get("spend", 0) for m in prev_3), sum(m.get("clicks", 0) for m in prev_3))
        
        if avg_ctr_prev > 0 and avg_ctr_now < avg_ctr_prev * 0.8:
            if avg_cpc_now > avg_cpc_prev * 1.15:
                return {
                    "pattern": "Creative Fatigue Detected",
                    "evidence": f"CTR dropped {((1 - avg_ctr_now/avg_ctr_prev)*100):.1f}% while CPC rose {((avg_cpc_now/avg_cpc_prev - 1)*100):.1f}%",
                    "proactive_step": "Rotate creatives immediately. Current set has reached saturation."
                }
        return None

    def detect_learning_trap(self, campaign):
        """Detect if a campaign is stuck in learning phase."""
        impressions = campaign.get("impressions", 0)
        created_at = campaign.get("created_time") or campaign.get("start_time")
        conversions = campaign.get("conversions", campaign.get("leads", 0))
        
        # Simple proxy for days active if created_at is available
        days_active = 0
        if created_at:
            try:
                # Basic string Parse (Google/Meta formats differ but this is a proxy)
                dt = str(created_at).split("T")[0]
                td = datetime.date.today() - datetime.datetime.strptime(dt, "%Y-%m-%d").date()
                days_active = td.days
            except:
                pass
        
        if days_active > 7 and conversions < 5 and impressions > 1000:
            return {
                "pattern": "Algorithm Learning Trap",
                "evidence": f"Campaign active {days_active} days with {conversions} conversions @ {impressions} imps",
                "proactive_step": "Algorithm is struggling to find audience. Reset with broader targeting or switch to clicks-focus temporarily."
            }
        return None
