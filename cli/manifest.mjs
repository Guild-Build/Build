// One pure validator for the planner, Functions and CLI.
export const CATEGORIES = ['delivery', 'review', 'cost', 'knowledge', 'proving', 'research', 'data', 'other'];
export const LICENSES = ['Apache-2.0', 'MIT', 'Proprietary'];
// The model the hosted season trial runs on (.github/workflows/trial.yml). `buildguild test` and `wrap` require a model,
// so every run command the site shows names one: this, or the model of the record being reproduced.
export const SEASON_MODEL = 'claude-sonnet-5-5';
export const MODULE_TYPES = ['skill', 'agent', 'hook', 'mcp', 'playbook', 'tool'];
export const TRIALS = ['calibration-shell-v1', 'guild-smoke-v1'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'default'];
const slug = s => typeof s === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
const length = (s, min, max = Infinity) => typeof s === 'string' && s.trim().length >= min && s.length <= max;

export function validateManifest(manifest) {
  const m = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : {};
  const problems = [];
  const need = (ok, message) => { if (!ok) problems.push(`buildguild.json: ${message}`); };
  need(m.schema === 'buildguild.build.v1', 'schema must be buildguild.build.v1');
  need(slug(m.slug) && length(m.slug, 3, 48), 'slug must be kebab-case, 3 to 48 characters');
  need(length(m.name, 3, 60), 'name must be 3 to 60 characters');
  need(length(m.summary, 40, 300), 'summary must be 40 to 300 characters');
  need(CATEGORIES.includes(m.category), `category must be one of ${CATEGORIES.join(', ')}`);
  need(LICENSES.includes(m.license), `license must be one of ${LICENSES.join(', ')}`);
  need(Array.isArray(m.branches) && m.branches.length > 0 && m.branches.every(b => ['claude-code', 'codex'].includes(b)), 'branches must contain claude-code or codex');
  need(Array.isArray(m.modules) && m.modules.length > 0, 'at least one module is required');
  if (Array.isArray(m.modules)) for (const ref of m.modules) {
    const parts = typeof ref === 'string' ? ref.split('/') : [];
    need(parts.length === 2 && MODULE_TYPES.includes(parts[0]) && slug(parts[1]), 'each module must be type/slug with a known type');
  }
  need(Array.isArray(m.agentProfiles) && m.agentProfiles.length > 0, 'at least one agent profile is required');
  if (Array.isArray(m.agentProfiles)) for (const p of m.agentProfiles) {
    need(length(p?.role, 1) && length(p?.model, 1), 'every agent profile needs role and model');
    need(EFFORTS.includes(p?.effort), `profile effort must be one of ${EFFORTS.join(', ')}`);
    need(length(p?.limits, 10) && !/[\r\n]/.test(p?.limits), 'profile limits must be one line of at least 10 characters');
  }
  need(m.trial === undefined || TRIALS.includes(m.trial), 'trial must name a known trial or be absent');
  for (const key of ['rights', 'optIn']) need(m[key] === undefined || typeof m[key] === 'boolean', `${key} consent must be a boolean`);
  return problems;
}
