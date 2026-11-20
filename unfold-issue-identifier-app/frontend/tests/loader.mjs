// Lets `node --test` run JSX directly, using the esbuild that vite already
// pulls in. Avoids adding a second test runner just to render a few pages.
import { transformSync } from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {};', shortCircuit: true };
  }

  if (url.endsWith('.jsx')) {
    const loaded = await nextLoad(url, { ...context, format: 'module' });
    const source = loaded.source.toString();
    const { code } = transformSync(source, {
      loader: 'jsx',
      format: 'esm',
      jsx: 'automatic',
      target: 'node20',
      sourcefile: url,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }

  return nextLoad(url, context);
}
