import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const trialTemplates = ['scoped-config-change', 'blocked-handoff'];

export function trialTemplateFiles({ slug, author, license, template }) {
  if (!trialTemplates.includes(template)) throw Error(`template must be one of ${trialTemplates.join(', ')}`);
  const base = fileURLToPath(new URL(`./templates/${template}/`, import.meta.url));
  const metadata = JSON.parse(readFileSync(join(base, 'template.json'), 'utf8'));
  const title = slug.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  const files = {};
  function collect(relative = '') {
    for (const name of readdirSync(join(base, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(join(base, path));
      if (stat.isDirectory()) collect(path);
      else if (!stat.isFile()) throw Error(`template contains a link or special file: ${path}`);
      else if (path !== 'template.json') files[path] = readFileSync(join(base, path), 'utf8');
    }
  }
  collect();
  files['README.md'] = files['README.md'].replaceAll('{{TRIAL_NAME}}', title).replaceAll('{{TRIAL_SLUG}}', slug);
  files['trial.json'] = JSON.stringify({
    schema: 'buildguild.trial.v1', slug, name: title, version: '0.1.0', kind: 'community', author, license,
    summary: metadata.summary, categories: metadata.categories, measures: metadata.measures, cases: metadata.cases,
    tolerance: { overall: 0.1, dimension: 0.25 }, hiddenSlice: { count: 0, published: null }, runner: 'claude plugin eval',
    template: { id: metadata.id, version: metadata.version },
  }, null, 2) + '\n';
  const templateLicense = readFileSync(new URL('./templates/LICENSE', import.meta.url), 'utf8');
  files['LICENSE'] = license === 'Apache-2.0' ? templateLicense : `${license}\n\nThe included BuildGuild template content remains covered by TEMPLATE-LICENSE.\n`;
  files['TEMPLATE-LICENSE'] = templateLicense;
  files['NOTICE.md'] = `This trial starts from BuildGuild's ${metadata.id} template v${metadata.version}.\nTemplate content is licensed under Apache-2.0; see TEMPLATE-LICENSE.\nReference examples are synthetic authoring checks, not model evidence.\n`;
  return files;
}
