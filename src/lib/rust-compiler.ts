import p from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';

export function findCargoDir(path: string): string {
  if (path == process.cwd()) throw new Error('could not find cargo.toml');
  if (existsSync(p.resolve(path, 'Cargo.toml'))) return path;
  return findCargoDir(p.resolve(path, '..'));
}
/**
 * @param path path to any file or folder in the project
 * @returns path to package entrypoint
 */
export async function compileProject(
  path: string,
  outDir: string,
): Promise<string> {
  const projectRoot = findCargoDir(p.dirname(path));
  const packageOut = p.resolve(outDir, '../.cache', p.basename(projectRoot));
  const child = spawn('wasm-pack', [
    'build',
    '--target',
    'web',
    '--out-dir',
    packageOut,
  ], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  await new Promise<void>((r) => child.addListener('exit', () => r()));
  return packageOut;
}
