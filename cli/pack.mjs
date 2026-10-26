// Keep the distributed CLI and validator in the same relative layout as the checkout.
import { mkdirSync, copyFileSync } from 'node:fs';
const root = new URL('./dist/cli/', import.meta.url);
mkdirSync(root, { recursive: true });
for (const file of ['buildguild.mjs', 'manifest.mjs']) copyFileSync(new URL(file, import.meta.url), new URL(file, root));
