import sys
import os
sys.path.append("/Users/apple/Downloads/AdPilot-V3-Complete-Final/ads_agent")
from google_ads_api import get_report

gaql = "SELECT search_term_view.search_term, campaign.name, campaign.id, ad_group.name, ad_group.id, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date BETWEEN '2026-03-01' AND '2026-04-09'"
res = get_report("search_term_view", query=gaql)
print(res)
