import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });

let html = await readFile('index.html', 'utf8');
html = html.replace('src="/src/main.ts"', 'src="./src/main.js"');
await writeFile('dist/index.html', html);

if (!existsSync('dist/src/styles.css')) {
  await cp('src/styles.css', 'dist/src/styles.css');
}

console.log('Dist folder prepared for GitHub Pages.');
