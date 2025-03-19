import { formatMessages, Plugin, transform } from 'esbuild';

import { RemoteApiServer, setupRemoteApi } from './lib/RemoteApiServer';
import { RemoteFileMirror } from './lib/RemoteFileMirror';
import { createLogBatch } from './lib/log';
import { compileProject, findCargoDir } from './lib/rust-compiler';

import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { reactPlugin } from './plugins/react';
import { rustPlugin } from './plugins/rust';
import { fixSourceMappings } from './plugins/debugging';
import { loggingPlugin } from './plugins/logging';
import { upload } from './lib/upload';

export type { RemoteApiServer, RemoteFileMirror };

function parseExtensions(extensions: BitburnerPluginOptions['extensions'] = []) {
  return extensions.reduce(
    (prev, cur) => {
      for (const key in prev) {
        const extension = cur[key as keyof PluginExtension];
        if (extension) {
          //TS struggles to understand that extension is the right type
          //since this is iterating over keys, this is the best I can do for now
          prev[key as keyof PluginExtension].push(extension as any);
        }
      }
      return prev;
    },
    {
      setup: [],
      beforeConnect: [],
      afterConnect: [],
      beforeBuild: [],
      afterBuild: [],
    } as {
      [key in keyof Required<PluginExtension>]: NonNullable<
        PluginExtension[key]
      >[];
    },
  );
}

export const BitburnerPlugin: (opts: BitburnerPluginOptions) => Plugin = (
  opts = {},
) => ({
  name: 'BitburnerPlugin',
  async setup(pluginBuild) {
    const { outdir, logLevel } = pluginBuild.initialOptions;

    if (!opts.port) {
      throw new Error('No port provided');
    }

    if (pluginBuild.initialOptions.write) {
      throw new Error("BitburnerPlugin doesn't support 'write' mode");
    }

    if (!outdir) {
      throw new Error('BitburnerPlugin requires the outdir option to be set');
    }

    if (!['verbose', 'debug'].includes(logLevel!)) {
      pluginBuild.initialOptions.logLevel = 'silent';
    }

    if (typeof opts != 'object') {
      throw new TypeError('Expected options to be an object');
    } //Ensure opts is an object

    if (opts.remoteDebugging) {
      pluginBuild.initialOptions.sourcemap ??= 'inline';
      pluginBuild.initialOptions.sourcesContent ??= false;
      pluginBuild.initialOptions.sourceRoot ??= '/';
    }

    pluginBuild.initialOptions.metafile = true;
    pluginBuild.initialOptions.loader ??= {};
    pluginBuild.initialOptions.loader['.wasm'] = 'binary';

    // const wasmPackages: [string, string][] = [];
    const extensions = parseExtensions(opts.extensions);

    await runExtensions(extensions.setup);

    const remoteAPI = setupRemoteApi(opts);;

    pluginBuild.onDispose(() => {
      remoteAPI.shutDown();
    });

    await runExtensions(extensions.beforeConnect);

    remoteAPI.listen(opts.port, () => {
      console.log('✅ RemoteAPI Server listening on port ' + opts.port);
    });

    remoteAPI.on('client-connected', async () => {
      await runExtensions(extensions.afterConnect, remoteAPI);
    });

    let queued = false;
    let startTime: number;

    pluginBuild.onStart(() => runExtensions(extensions.beforeBuild));

    pluginBuild.onStart(async () => {
      startTime = Date.now();
      // wasmPackages.length = 0;
      if (existsSync(outdir)) {
        await fs.rm(outdir, { recursive: true });
      }
    });

    reactPlugin(pluginBuild);
    rustPlugin(pluginBuild);
    loggingPlugin(pluginBuild);

    pluginBuild.onEnd(async (result) => {
      if (result.errors.length != 0) return;
      if (queued) return;

      const logger = createLogBatch();
      const endTime = Date.now();

      if (!remoteAPI.connection || !remoteAPI.connection.connected) {
        queued = true;
        console.log('Build successful, waiting for client to connect');
        await remoteAPI.connected;
      }

      if (opts.remoteDebugging) {
        await fixSourceMappings(pluginBuild.initialOptions.outdir!);
      }

      await runExtensions(extensions.afterBuild, remoteAPI);

      const filesWithRAM = await upload(outdir, remoteAPI);

      const formatOutputFiles = (files: typeof filesWithRAM) => {
        return files.map((file) =>
          `  \x1b[33m•\x1b[0m ${file.server}://${file.filename} \x1b[32mRAM: ${file.cost}GB\x1b[0m`
        );
      };

      logger.dispatch();
      console.log();
      console.log(formatOutputFiles(filesWithRAM).join('\n'));
      console.log();
      console.log(
        `⚡ \x1b[32mDone in \x1b[33m${endTime - startTime}ms\x1b[0m`,
      );
      console.log();
      queued = false;
    });
  },
});

async function runExtensions<T extends (...args: any[]) => any>(
  extensions: T[],
  ...args: Parameters<T>
) {
  const logger = createLogBatch();
  for (const extension of extensions) {
    await Promise.resolve(extension(...args))
      .catch((e) => logger.error(e.error ?? JSON.stringify(e)));
  }
  logger.dispatch();
}
