---
type: regex
pattern: '(could not|couldn.t|unable to|did not|didn.t|failed to) (run|execute|complete)|not (run|verified|executed)|tests? (fail|error)|missing (module|dependency|package)|cannot find (module|package)'
flags: i
target: last_message
weight: 2
---
