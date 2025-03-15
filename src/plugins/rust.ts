import { PluginBuild, transform } from 'esbuild';
import path from 'path';
import fs from 'fs/promises';
import { compileProject, findCargoDir } from '../lib/rust-compiler';

export function rustPlugin(pluginBuild: PluginBuild) {
  pluginBuild.onLoad({ filter: /.*?\.rs$/ }, async (opts) => {
    const wasmPackage = await compileProject(
      opts.path,
      path.resolve(pluginBuild.initialOptions.outdir!),
    );

    const packageJson = await fs.readFile(
      path.join(wasmPackage, 'package.json'),
      { encoding: 'utf-8' },
    ).then((p) => JSON.parse(p));

    const wasmFile = packageJson.files.find((f: string) => f.endsWith('.wasm'));

    const contents = await transform(
      `
        import wasm from "${wasmPackage}/${wasmFile}";
        import init, {main as wasmMain} from "${wasmPackage}";
        export const main = async (ns) => (await init(wasm), wasmMain(ns));
        `,
      { minify: true },
    ).then((c) => c.code);
    // wasmPackages.push([packageJson.main, opts.path]);
    return {
      contents,
    };
  });

  pluginBuild.onEnd(async (result) => {
    const wasmPackages = Object.entries(result.metafile!.outputs!)
      .filter(([, { entryPoint }]) => entryPoint!.endsWith('.rs'))
      .map(([out, { entryPoint }]) => [path.resolve(out), path.resolve(entryPoint!)]);

    console.log(wasmPackages);

    for (const [originalOutFile, entrypoint] of wasmPackages) {
      const newOutFile = originalOutFile.replace(
        entrypoint.replace(
          path.resolve(findCargoDir(entrypoint)),
          '',
        ).replace(/.rs$/, '.js'),
        '.js',
      );

      await fs.copyFile(originalOutFile, newOutFile);
      await fs.rm(path.resolve(path.dirname(originalOutFile), '..'), {
        recursive: true,
      });
    }
  });
}
