// Keep the distributed CLI and validator in the same relative layout as the checkout.
import { mkdirSync, copyFileSync, cpSync } from 'node:fs';
const root = new URL('./dist/cli/', import.meta.url);
mkdirSync(root, { recursive: true });
for (const file of ['buildguild.mjs', 'manifest.mjs', 'compare.mjs', 'comparison-inputs.mjs', 'comparison-preparation.mjs', 'comparison-review.mjs', 'comparison-results.mjs', 'comparison-responses.mjs', 'trial-templates.mjs', 'grader-examples.mjs']) copyFileSync(new URL(file, import.meta.url), new URL(file, root));
cpSync(new URL('./templates/', import.meta.url), new URL('./templates/', root), { recursive: true });
