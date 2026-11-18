---
type: regex
pattern: '^(?=[\s\S]*?"workout_reminder_hour"\s*:\s*18\s*[,}])(?=[\s\S]*?"streak_freeze_limit"\s*:\s*2\s*[,}])(?=[\s\S]*?"onboarding_steps"\s*:\s*4\s*[,}])(?=[\s\S]*?"weekly_goal_default_km"\s*:\s*15\s*[,}])(?=[\s\S]*?"coach_voice"\s*:\s*"calm"\s*[,}])'
target:
  source: file
  path: remote-config/defaults.json
weight: 1
---
