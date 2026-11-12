// A scripted stand-in for the Anthropic Messages API, for proving the Client Deployment Trial's fixtures inside Claude
// Code's sandbox on a free runner. It listens on 127.0.0.1 only and plays an agent: it tells the case from the prompt,
// answers each turn with that case's next scripted tool call, and ends with the case's scripted reply. It records each
// tool result it gets back. It accepts only the self-test's placeholder key, calls nothing and costs nothing.
// Scratch only: modelled on .github/scripts/stand-in-api.mjs, which plays one Bash call.
import { createServer } from 'node:http';
import { STAND_IN_KEY, resultText } from '../../.github/scripts/stand-in-api.mjs';

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const textReply = t => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const errorBody = (type, message) => ({ type: 'error', error: { type, message } });
const textOf = m => !m ? '' : typeof m.content === 'string' ? m.content
  : Array.isArray(m.content) ? m.content.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';

// What the stand-in answers to one request. `sessions` maps a case name to { match, steps, final }: `match` is a line of
// the case's prompt, `steps` the tool calls in order ({ name, input }), `final` the reply (a string, or a function of
// the results so far).
export function decide(body, { sessions, prefix, nextId }) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const firstText = textOf(messages.find(m => m && m.role === 'user'));
  const name = Object.keys(sessions).find(n => firstText.includes(sessions[n].match)) || null;
  const offersBash = Array.isArray(body.tools) && body.tools.some(t => t && t.name === 'Bash');
  if (!name || !offersBash) return { reply: textReply('ok'), name, step: null };
  const results = messages.flatMap(m => (m && m.role === 'user' && Array.isArray(m.content) ? m.content : []))
    .filter(b => b && b.type === 'tool_result' && String(b.tool_use_id).startsWith(prefix))
    .map(b => ({ id: b.tool_use_id, isError: b.is_error === true, text: resultText(b) }));
  const { steps, final } = sessions[name];
  if (results.length < steps.length) {
    const step = steps[results.length];
    return { reply: { content: [{ type: 'tool_use', id: `${prefix}${nextId()}`, name: step.name || 'Bash', input: step.input }], stop_reason: 'tool_use' }, name, step: results.length, results };
  }
  return { reply: textReply(typeof final === 'function' ? final(results) : final), name, step: 'final', results };
}

function writeStream(res, model, id, reply) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': id });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: USAGE } });
  reply.content.forEach((block, index) => {
    if (block.type === 'text') {
      event('content_block_start', { index, content_block: { type: 'text', text: '' } });
      event('content_block_delta', { index, delta: { type: 'text_delta', text: block.text } });
    } else {
      event('content_block_start', { index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      event('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    event('content_block_stop', { index });
  });
  event('message_delta', { delta: { stop_reason: reply.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } });
  event('message_stop', {});
  res.end();
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Starts the stand-in on a free port of 127.0.0.1. `log` fills with one entry per request: the case it was for, the
// step answered, and, when the case's reply is sent, every tool result of that conversation.
export function startScriptedStandIn({ sessions, tag }) {
  const log = [];
  const prefix = `toolu_fixture_proof_${tag}_`;
  let calls = 0;
  let replies = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      const line = { method: req.method, path };
      log.push(line);
      if (req.method !== 'POST' || (path !== '/v1/messages' && path !== '/v1/messages/count_tokens')) {
        line.answer = 404;
        return writeJson(res, 404, errorBody('not_found_error', `the stand-in serves only POST /v1/messages, not ${req.method} ${path}`));
      }
      if (req.headers['x-api-key'] !== STAND_IN_KEY) { line.answer = 401; return writeJson(res, 401, errorBody('authentication_error', 'placeholder key only')); }
      let body;
      try { body = JSON.parse(raw); } catch { line.answer = 400; return writeJson(res, 400, errorBody('invalid_request_error', 'the request body is not JSON')); }
      if (path === '/v1/messages/count_tokens') { line.answer = 'count'; return writeJson(res, 200, { input_tokens: 1 }); }
      const d = decide(body, { sessions, prefix, nextId: () => ++calls });
      Object.assign(line, { model: body.model, stream: body.stream === true, case: d.name, step: d.step,
        answer: d.reply.stop_reason === 'tool_use' ? `${d.reply.content[0].name} call` : 'text' });
      if (d.step === 'final') line.results = d.results;
      const id = `msg_fixture_proof_${tag}_${++replies}`;
      if (body.stream === true) return writeStream(res, body.model, id, d.reply);
      return writeJson(res, 200, { id, type: 'message', role: 'assistant', model: body.model, content: d.reply.content, stop_reason: d.reply.stop_reason, stop_sequence: null, usage: USAGE });
    });
  });
  return new Promise((resolvePort, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePort({
      port: server.address().port,
      log,
      close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }),
    }));
  });
}
