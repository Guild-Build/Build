// The form of the files that define a case in a run on unpublished cases (`unpublished`, `test --unpublished`,
// `wrap --unpublished` in buildguild.mjs): the public trial's form only, as content/trials/client-deployment-v1/cases/ writes
// it, in a small exact subset checked line by line in the preflight. This is the mode's own rule, not a copy of the runner's
// loader: whether the runner loads a case is the runner's to decide (a run it could not load gives no record).
//
// The runner (Claude Code 2.1.321) reads case.yaml, and the front matter of prompt.md and of each grader, with Bun.YAML.parse.
// It takes a case's name from case.yaml, or from a `name` in prompt.md's front matter, which overrides it, else from the
// folder; names a grader after its file unless its front matter sets `name`; skips a grader file with no front matter; closes
// front matter at the first "---" it meets, even inside a line; loads a case's `plugins` and a plugin manifest it finds in a
// case folder; and leaves a with-only grader (an `arm` of with-only, a tool_used grader of the Skill tool, a grader of
// mock_calls) out of the bare arm. So the subset is meant to be read as the check reads it: each case named after its folder,
// each grader after its file, every grader scoring both arms, the build the only plugin. Anything outside it is refused, never
// interpreted.
//
// Each file's keys with their value rules are PROMPT_KEYS, GRADER_KEYS and caseYamlKeys(...). A key's `value` is the rule for
// a value on its own line; `nested` lists, in order, the keys that follow on their own lines, two spaces in, when the key is
// given with no value, each with its rule. A rule for a whole number or a decimal carries its `range` (low, high and the step
// between values), so the tests can find its edges.

// The names allowed anywhere under cases/: letters, digits, ".", "_" and "-", and neither "." nor "..". Every later step (the
// checksum's lines, the paths the run writes) can take such a name.
export const CASE_PATH_NAME = /^[A-Za-z0-9._-]+$/;
// A plain value a YAML reader takes as text: not a boolean, a null, a number or a date in either YAML 1.1 or 1.2.
const YAML_WORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n']);
export const yamlText = v => !YAML_WORDS.has(v.toLowerCase())
  && !/^[-+]?(\d[\d_]*|0x[\da-f]+|0o[0-7]+|0b[01]+|(\d+\.?\d*|\.\d+)(e[-+]?\d+)?|\.inf|\.nan)$/i.test(v) && !/^\d{4}-\d\d?-\d\d?$/.test(v);
// A plain value YAML reads as text: it starts with a letter, a digit, "." or "_", never with an indicator ("-", "?", ":", ",",
// "[", "]", "{", "}", "#", "&", "*", "!", "|", ">", "'", quote, "%", "@", backtick) or "~"; it is not dots only; and it is not
// one of the words or numbers above.
export const plainText = v => /^[A-Za-z0-9._]/.test(v) && !/^\.+$/.test(v) && yamlText(v);
export const WORD = v => /^[a-z0-9][a-z0-9-]*$/.test(v) && yamlText(v);
const TOOL = v => /^[A-Za-z][A-Za-z0-9_]*$/.test(v) && yamlText(v);
const LIST = item => v => { const m = v.match(/^\[(.+)\]$/); return m !== null && m[1].split(', ').every(item); };
const WHOLE = (low, high) => Object.assign(v => /^(0|[1-9]\d*)$/.test(v) && Number(v) >= low && Number(v) <= high, { range: { low, high, step: 1 } });
// A weight is a decimal from 0.01 to 1000 with at most four digits after the point: wider than any real case, and no sum of
// 256 of them can overflow the runner's weighted score.
const WEIGHT = Object.assign(v => /^(0|[1-9]\d{0,3})(\.\d{1,4})?$/.test(v) && Number(v) >= 0.01 && Number(v) <= 1000, { range: { low: 0.01, high: 1000, step: 0.0001 } });
// One single-quoted line with no quote and no control or line-separator character inside: YAML reads its text exactly.
const UNQUOTED_BREAKS = [0x2028, 0x2029, 0xfeff, 0xfffe, 0xffff].map(code => String.fromCharCode(code));
const QUOTED = v => /^'[^']*'$/.test(v) && !/[\x00-\x1f\x7f-\x9f]/.test(v) && !UNQUOTED_BREAKS.some(c => v.includes(c));
const RELATIVE_PATH = v => plainText(v) && v.split('/').every(s => CASE_PATH_NAME.test(s) && !/^\.+$/.test(s));
// The keys of each file, each value's one form, and what that form is, for the refusal. They are the keys the public trial's
// eight cases use; a tool_used grader only as the public trial's one grader of that type writes it (of the Read tool).
export const PROMPT_KEYS = {
  tags: { value: LIST(WORD), says: 'a list of lower-case words, as [safety, deployment]' },
  runs: { value: WHOLE(1, 50), says: 'a whole number from 1 to 50' },
  max_turns: { value: WHOLE(1, 200), says: 'a whole number from 1 to 200' },
  timeout_seconds: { value: WHOLE(1, 3600), says: 'a whole number from 1 to 3600' },
  allowed_tools: { value: LIST(TOOL), says: 'a list of tool names, as [Read, Write]' },
};
// The keys each type of grader takes, and the ones it needs. A grader's type is one of these, by its own rule below.
export const GRADER_TYPES = {
  regex: { keys: ['type', 'pattern', 'flags', 'match', 'target', 'weight'], needs: ['pattern'] },
  tool_used: { keys: ['type', 'tool', 'input_match', 'min', 'max', 'weight'], needs: ['tool'] },
};
export const GRADER_KEYS = {
  type: { value: v => Object.hasOwn(GRADER_TYPES, v), says: 'regex, or tool_used as the public trial writes it' },
  pattern: { value: QUOTED, says: 'one single-quoted line with no quote inside' },
  flags: { value: v => /^[dgimsuvy]+$/.test(v) && yamlText(v), says: 'regular expression flags (d, g, i, m, s, u, v, y), not y alone' },
  match: { value: v => v === 'contains' || v === 'not_contains', says: 'contains or not_contains' },
  target: { value: v => v === 'last_message', nested: [['source', v => v === 'file'], ['path', RELATIVE_PATH]], says: 'last_message, or no value and then "  source: file" and "  path: <a relative path>"' },
  weight: { value: WEIGHT, says: 'a decimal from 0.01 to 1000 with at most four digits after the point' },
  tool: { value: v => v === 'Read', says: 'Read, the one tool a tool_used grader names in the public trial' },
  input_match: { value: QUOTED, says: 'one single-quoted line with no quote inside' },
  min: { value: WHOLE(0, Number.MAX_SAFE_INTEGER), says: 'a whole number' },
  max: { value: WHOLE(0, Number.MAX_SAFE_INTEGER), says: 'a whole number' },
};
// The keys of a case's case.yaml: `name` is its folder's name, and the scaffold script is a file the case holds (holds(name)).
export const caseYamlKeys = (folder, holds) => ({
  schema_version: { value: v => v === '"1.1"', says: '"1.1"' },
  name: { value: v => v === folder, says: `the folder's name, ${folder}` },
  context: { nested: [['scaffold_script', v => CASE_PATH_NAME.test(v) && plainText(v) && holds(v)]], says: '"  scaffold_script: <a file of this case>" on the next line' },
});
// The loader's fixed limits, read from Claude Code 2.1.321 (vd, nu and Os in its loader): 1,048,576 bytes for case.yaml,
// prompt.md and each grader file, and 256 .md files in graders/. They are the last facts of the loader this check copies.
export const DEFINITION_BYTES = 1048576, GRADER_FILES = 256;
// The runner's blank `init` templates, which it refuses to run (Claude Code 2.1.321).
export const PROMPT_TEMPLATE = 'TODO: describe what the agent should do';
export const GRADER_TEMPLATE = 'TODO: describe what a successful response looks like';
// The lines of prompt.md's or a grader's front matter, and its body: the file opens with a line that is exactly "---" and the
// front matter runs to the next line that is exactly "---", with no "---" anywhere in between. null otherwise.
export function frontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return null;
  const close = lines.indexOf('---', 1);
  if (close < 0 || lines.slice(1, close).some(line => line.includes('---'))) return null;
  return { lines: lines.slice(1, close), body: lines.slice(close + 1).join('\n') };
}
