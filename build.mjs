import { context } from "esbuild";

const WATCH = process.argv.includes('--watch');

const createContext = async () => await context({
  entryPoints: ["src/index.ts"],
  outfile: './build/index.js',
  bundle: true,
  tsconfig: './tsconfig.json',
  platform: 'node',
  packages: 'external'
});

const ctx = await createContext();
if (WATCH) {
  ctx.watch();
} else {
  await ctx.rebuild();
  ctx.dispose();
}
