# Prototype of the complete-trace definition, run over a folder of claude-eval-*/out/trace.jsonl (or */trace.jsonl).
import json, os, sys, collections
root = sys.argv[1]
paths = []
for d in sorted(os.listdir(root)):
    for p in (os.path.join(root, d, 'out', 'trace.jsonl'), os.path.join(root, d, 'trace.jsonl')):
        if os.path.isfile(p): paths.append((d, p)); break
req_all = collections.Counter(); res_all = collections.Counter()
for name, p in paths:
    raw = open(p, 'rb').read().decode('utf-8')
    lines = [l for l in raw.split('\n') if l.strip()]
    events = []; unreadable = 0
    for l in lines:
        try:
            e = json.loads(l)
            if isinstance(e, dict): events.append(e)
            else: unreadable += 1
        except Exception: unreadable += 1
    finals = sum(1 for e in events if e.get('type') == 'result')
    last = None
    try: last = json.loads(lines[-1]) if lines else None
    except Exception: pass
    ends = isinstance(last, dict) and last.get('type') == 'result'
    reqs = collections.Counter(); ress = collections.Counter(); names = {}
    sub = 0
    for e in events:
        if e.get('parent_tool_use_id'): sub += 1
        c = (e.get('message') or {}).get('content')
        if not isinstance(c, list): continue
        for b in c:
            if not isinstance(b, dict): continue
            if e.get('type') == 'assistant' and b.get('type') == 'tool_use': reqs[b.get('id')] += 1; names[b.get('id')] = b.get('name')
            if e.get('type') == 'user' and b.get('type') == 'tool_result': ress[b.get('tool_use_id')] += 1
    unanswered = [i for i in reqs if ress[i] == 0]
    twice = [i for i in reqs if ress[i] > 1]
    orphans = [i for i in ress if i not in reqs]
    req_all.update(reqs); res_all.update(ress)
    tools = collections.Counter(names.values())
    print(f'{name}: lines={len(lines)} unreadable={unreadable} finals={finals} endsWithResult={ends} last={last.get("type") if isinstance(last, dict) else None}/{last.get("subtype") if isinstance(last, dict) else None} requests={sum(reqs.values())} results={sum(ress.values())} unanswered={len(unanswered)} twice={len(twice)} orphans={len(orphans)} subagentEvents={sub} tools={dict(tools)}')
print('part 4: request ids seen more than once:', sum(1 for v in req_all.values() if v > 1), '| result ids seen more than once:', sum(1 for v in res_all.values() if v > 1), '| traces:', len(paths))
