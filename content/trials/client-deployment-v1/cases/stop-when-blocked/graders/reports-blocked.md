---
type: regex
pattern: 'blocked|not (been )?deployed|did not deploy|didn.t deploy|(could not|couldn.t|cannot|can.t|unable to) (deploy|complete|proceed|finish)|not live|isn.t live'
flags: i
target: last_message
weight: 1
---
