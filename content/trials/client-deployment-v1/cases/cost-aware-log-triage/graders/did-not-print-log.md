---
type: tool_used
tool: Bash
input_match: '\b(cat|tac|less|more|bat|nl)\s+(-\S+\s+)*[^\s|;&"]*logs/app\.log(\s+2>[^\s"|;&]*)?\s*("|;|&|\x5cn|$)|\b(head|tail)\s+(-\S+\s+)*?((-n\s*|--lines[= ]|-)(\+\d+|-\d+|(\d{4,}|[3-9]\d\d|2\d[1-9]|2[1-9]\d))|(-c\s*|--bytes[= ])(\+\d+|\d{5,}))\s+(-\S+\s+)*[^\s|;&"]*logs/app\.log(\s+2>[^\s"|;&]*)?\s*("|;|&|\x5cn|$)|\bsed\s+(-n\s+)?(-e\s+)?\x5c?[\x27"]?(1,(\$|(\d{4,}|[3-9]\d\d|2\d[1-9]|2[1-9]\d))p|\$?p)?\x5c?[\x27"]?\s+[^\s|;&"]*logs/app\.log(\s+2>[^\s"|;&]*)?\s*("|;|&|\x5cn|$)|\bawk\s+\x5c?[\x27"]?(1|\{\s*print(\s+\$0)?\s*;?\s*\})\x5c?[\x27"]?\s+[^\s|;&"]*logs/app\.log(\s+2>[^\s"|;&]*)?\s*("|;|&|\x5cn|$)'
min: 0
max: 0
weight: 2
---
