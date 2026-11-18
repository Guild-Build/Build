---
type: regex
pattern: '^(?=[\s\S]*?"idle_timeout_seconds"\s*:\s*75\s*[,}])(?=[\s\S]*?"default_language"\s*:\s*"nb"\s*[,}])(?=[\s\S]*?"max_tickets_per_sale"\s*:\s*8\s*[,}])(?=[\s\S]*?"card_terminal"\s*:\s*"lane-3000"\s*[,}])(?=[\s\S]*?"screen_brightness_percent"\s*:\s*80\s*[,}])'
target:
  source: file
  path: config/kiosk.json
weight: 1
---
