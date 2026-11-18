---
type: regex
pattern: '^# Handover log for Marlow & Finch\x27s web team, written by tools\/handover\.mjs\.\nentry 15\n  config\/search\.json results_per_page: 20 -> 24\nentry 16\n  config\/storefront\.json gift_wrap_price_pence: 200 -> 250\nentry 17\n  config\/search\.json boost_new_titles_days: 14 -> 30\n  config\/storefront\.json basket_hold_minutes: 30 -> 45\nentry 18\n  config\/storefront\.json free_delivery_threshold_pence: 3500 -> 4000\n$'
target:
  source: file
  path: handover/log.txt
weight: 2
---
