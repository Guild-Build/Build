// A stand-in for the Anthropic Messages API, for the sandbox self-test. It listens on 127.0.0.1 only and plays the
// model: a request that offers the Bash tool gets back one Bash call running the command it was given, and the request
// that carries that call's result back gets a closing reply. It records each result the Bash tool returned, so the
// self-test judges what really ran. It accepts only its own placeholder key, calls nothing, and costs nothing.
import { createServer } from 'node:http';

// Not a key: the self-test hands this to Claude Code so that no real key is needed or sent.
export const STAND_IN_KEY = 'sandbox-self-test-placeholder-not-a-key';
const ID_PREFIX = 'toolu_sandbox_self_test_';
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

const text = t => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
const errorBody = (type, message) => ({ type: 'error', error: { type, message } });

// The text of a tool result, which Claude Code sends as a string or as a list of text blocks.
export function resultText(block) {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) return block.content.map(b => (b && b.type === 'text' ? b.text : '')).join('\n');
  return '';
}

// What the stand-in answers to one Messages request, and the Bash results it carries back for the first time.
export function decide(body, { command, seen, nextId }) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const returned = messages.flatMap(m => (m.role === 'user' && Array.isArray(m.content) ? m.content : []))
    .filter(b => b && b.type === 'tool_result' && String(b.tool_use_id).startsWith(ID_PREFIX));
  const fresh = returned.filter(b => !seen.has(b.tool_use_id));
  const results = fresh.map(b => ({ id: b.tool_use_id, isError: b.is_error === true, text: resultText(b) }));
  // One Bash call per conversation: once its result is back, every later turn just closes.
  if (returned.length) return { reply: text('The self-test command ran; nothing else to do.'), results };
  const offersBash = Array.isArray(body.tools) && body.tools.some(t => t && t.name === 'Bash');
  if (!offersBash) return { reply: text('ok'), results };
  return {
    reply: { content: [{ type: 'tool_use', id: `${ID_PREFIX}${nextId()}`, name: 'Bash', input: { command, description: 'Sandbox self-test command' } }], stop_reason: 'tool_use' },
    results,
  };
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

// Starts the stand-in on a free port of 127.0.0.1. `results` fills with each Bash result as it arrives; `requests` with
// one line per request (path, model, whether it streamed, the tools offered, and what was answered), never the prompt.
export function startStandIn({ command }) {
  const results = [];
  const requests = [];
  const seen = new Set();
  let calls = 0;
  let replies = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      const line = { method: req.method, path };
      requests.push(line);
      if (req.method !== 'POST' || (path !== '/v1/messages' && path !== '/v1/messages/count_tokens')) {
        line.answer = 404;
        return writeJson(res, 404, errorBody('not_found_error', `the stand-in serves only POST /v1/messages, not ${req.method} ${path}`));
      }
      if (req.headers['x-api-key'] !== STAND_IN_KEY) {
        line.answer = 401;
        return writeJson(res, 401, errorBody('authentication_error', 'the stand-in accepts only its own placeholder key'));
      }
      let body;
      try { body = JSON.parse(raw); } catch {
        line.answer = 400;
        return writeJson(res, 400, errorBody('invalid_request_error', 'the request body is not JSON'));
      }
      if (path === '/v1/messages/count_tokens') { line.answer = 'count'; return writeJson(res, 200, { input_tokens: 1 }); }
      const { reply, results: fresh } = decide(body, { command, seen, nextId: () => ++calls });
      for (const r of fresh) { seen.add(r.id); results.push(r); }
      Object.assign(line, {
        model: body.model,
        stream: body.stream === true,
        tools: Array.isArray(body.tools) ? body.tools.length : 0,
        bash: Array.isArray(body.tools) && body.tools.some(t => t && t.name === 'Bash'),
        resultsBack: fresh.length,
        answer: reply.stop_reason === 'tool_use' ? 'Bash call' : 'text',
      });
      const id = `msg_sandbox_self_test_${++replies}`;
      if (body.stream === true) return writeStream(res, body.model, id, reply);
      return writeJson(res, 200, { id, type: 'message', role: 'assistant', model: body.model, content: reply.content, stop_reason: reply.stop_reason, stop_sequence: null, usage: USAGE });
    });
  });
  return new Promise((resolvePort, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePort({
      port: server.address().port,
      results,
      requests,
      close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }),
    }));
  });
}
