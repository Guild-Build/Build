// Scratch investigation: drive the real `claude -p` through a stand-in model that asks for one Bash call with a given
// input, and print the tool result exactly as Claude Code writes it in stream-json (the format of eval traces).
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const KEY = 'scenario-placeholder-not-a-key';
const scenarios = JSON.parse(process.argv[2]);
const base = process.argv[3] || tmpdir();

function serve(sc) {
  const input = sc.input;
  let calls = 0;
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => {
      if (req.headers['x-api-key'] !== KEY) { res.writeHead(401); return res.end('{}'); }
      if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"input_tokens":1}'); }
      const body = JSON.parse(raw);
      const back = (body.messages || []).some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'));
      const bash = (body.tools || []).some(t => t.name === 'Bash');
      const has = name => (body.tools || []).some(t => t.name === name);
      // A scenario with tool Task asks the main agent for one Task call first; every later request with no tool result yet
      // (the subagent's) gets one Bash call running subInput.
      const content = !back && sc.tool === 'Task' && calls === 0 && has('Task') ? [{ type: 'tool_use', id: `toolu_scn_${++calls}`, name: 'Task', input }]
        : !back && bash ? [{ type: 'tool_use', id: `toolu_scn_${++calls}`, name: 'Bash', input: sc.tool === 'Task' ? sc.subInput : input }] : [{ type: 'text', text: 'done' }];
      const stop = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn';
      const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ id: 'msg_scn', type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'msg_scn', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } });
      content.forEach((b, index) => {
        if (b.type === 'text') { ev('content_block_start', { index, content_block: { type: 'text', text: '' } }); ev('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } }); }
        else { ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }); ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }); }
        ev('content_block_stop', { index });
      });
      ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
      ev('message_stop', {}); res.end();
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

for (const sc of scenarios) {
  const server = await serve(sc);
  const dir = mkdtempSync(join(base, 'scn-'));
  const home = join(dir, 'home'); const cwd = join(dir, 'cwd'); mkdirSync(home); mkdirSync(cwd);
  const settings = JSON.stringify(sc.settings || {});
  const args = ['-p', 'Run the command.', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-5-5', '--permission-mode', 'dontAsk', '--allowedTools', ...(sc.allowedTools || ['Bash']), '--max-turns', '6', '--settings', settings];
  const path = sc.hideSocat ? process.env.PATH.split(':').map(d => d === '/usr/bin' ? process.env.NOSOCAT_BIN : d).join(':') : process.env.PATH;
  const env = { PATH: path, HOME: home, TMPDIR: process.env.TMPDIR || '/tmp', LANG: 'en_US.UTF-8', ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: KEY, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  const out = await new Promise(done => {
    const child = spawn('claude', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = ''; child.stdout.on('data', d => { o += d; }); child.stderr.on('data', d => { e += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('exit', code => { clearTimeout(t); done({ o, e, code }); });
  });
  server.close();
  const lines = out.o.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { unparsed: l.slice(0, 200) }; } });
  const results = lines.filter(l => l.type === 'user' && Array.isArray(l.message?.content) && l.message.content.some(b => b.type === 'tool_result'));
  writeFileSync(join(dir, 'trace.jsonl'), out.o);
  console.log(`=== ${sc.name} (claude exit ${out.code})`);
  for (const r of results) {
    const b = r.message.content.find(x => x.type === 'tool_result');
    console.log(JSON.stringify({ is_error: b.is_error, content: b.content, tool_use_result: r.tool_use_result, tool_result_meta: r.tool_result_meta }));
  }
  if (!results.length) console.log('no tool result; stderr:', out.e.slice(0, 600), 'stdout tail:', out.o.slice(-400));
}
