import { formatMessages, formatMessagesSync, Metafile, Plugin } from 'esbuild';
import { RemoteApiInterface, RemoteApiServer } from './RemoteApiServer.ts';
import { walk } from '@std/fs/walk';

export declare type BitburnerPluginOptions = {
  /**
   * This is the port the RemoteAPI will connect to.
   * Enter the same port inside your game options to connect to your editor.
   */
  port?: number;

  /**
   * This is the path that the Netscript Definitions file will be placed at.
   */
  types?: string;

  /**
   * Set this to true to poll the filessytem instead of using filesystem events.
   * This can fix issues when using WSL but having the project inside the Windows filesystem.
   */
  usePolling?: boolean;

  /**
   * Sets the interval for the filesystem polling
   * Only used when usePolling is set to true.
   */
  pollingInterval?: number;

  /**
   * Set this to true to push mirrored files on connect.
   * By default the file mirror pulls the ingame files on connect, overriding local files with the current ingame state.
   */
  pushOnConnect?: boolean;

  /**
   * Use this to map a local directory to a list of ingame servers.
   * All the listed servers will be mirrored into that directory.
   */
  mirror?: {
    [path: string]: string[] | 'all' | 'own' | 'other';
  };

  /**
   * Use this to map a local directory to multiple servers.
   * All files in that directory will be uploaded to all of the listed servers.
   */
  distribute?: {
    [path: string]: string[] | 'all' | 'own' | 'other';
  };

  /**
   * A list of extensions for the Plugin to supplement and customize features.
   */
  extensions?: {
    setup?: () => void | Promise<void>;

    beforeConnect?: () => void | Promise<void>;
    afterConnect?: (remoteAPI: RemoteApiInterface) => void | Promise<void>;

    beforeBuild?: () => void | Promise<void>;
    afterBuild?: (remoteAPI: RemoteApiInterface, meta: Metafile) => void | Promise<void>;
  }[];

  /**
   * runs esbuild plugins as preprocessors
   * preprocessors have considerable implications for build times
   */
  preprocessors?: Plugin[];

  /**
   * Enable remote debugging. This will automatically set the right esbuild options if they arent set already.
   */
  remoteDebugging?: boolean;
};

export type PluginExtension = NonNullable<
  BitburnerPluginOptions['extensions']
>[number];

function parseExtensions(extensions: BitburnerPluginOptions['extensions'] = []) {
  type Hooks = {
    [key in keyof Required<PluginExtension>]: Required<PluginExtension>[key][];
  };

  const hooks: Hooks = {
    setup: [],
    beforeConnect: [],
    afterConnect: [],
    beforeBuild: [],
    afterBuild: [],
  };

  for (const extension of extensions) {
    for (const key in extension) {
      const hookType = key as keyof PluginExtension;
      const hook = extension[hookType];
      hooks[hookType as keyof PluginExtension].push(hook as any);
    }
  }

  return hooks;
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

    const remoteAPI = new RemoteApiServer({
      port: opts.port,
    });

    pluginBuild.onDispose(() => {
      remoteAPI.shutdown();
    });

    remoteAPI.addEventListener('client-connected', () => {
      if (!remoteAPI.interface) {
        console.error('remote api disconnected; after-connect hook');
        return;
      }

      runExtensions(extensions.afterConnect, remoteAPI.interface);
    });

    let queued = false;
    let startTime: number;

    pluginBuild.onStart(() => runExtensions(extensions.beforeBuild));

    pluginBuild.onStart(() => {
      startTime = Date.now();
      Deno.remove(outdir, { recursive: true }).catch(() => {});
    });

    pluginBuild.onResolve(
      { filter: /^react(-dom)?$/ },
      (opts) => ({
        namespace: 'react',
        path: opts.path,
      }),
    );

    pluginBuild.onLoad(
      { filter: /^react(-dom)?$/, namespace: 'react' },
      (opts) => ({
        contents: `module.exports = ${opts.path == 'react' ? 'React' : 'ReactDOM'}`,
      }),
    );

    pluginBuild.onEnd(async (result) => {
      if (!result.errors.length && !result.warnings.length) return;
      const logLevel = pluginBuild.initialOptions.logLevel ?? 'warning';

      if (logLevel == 'silent' || logLevel == 'info') {
        return;
      }

      const warnings = await formatMessages(result.warnings, {
        kind: 'warning',
        color: true,
      });

      while (warnings.length) {
        console.log(warnings.shift()?.trimEnd());
        console.log();
      }

      if (logLevel == 'warning') {
        return;
      }

      const errors = await formatMessages(result.errors, {
        kind: 'error',
        color: true,
      });

      while (errors.length) {
        console.log(errors.shift()?.trimEnd());
        console.log();
      }
    });

    pluginBuild.onEnd(async (result) => {
      if (result.errors.length != 0) return;
      if (queued) return;

      const endTime = Date.now();

      if (!remoteAPI.interface) {
        queued = true;
        console.log('Build successful, waiting for client to connect');
      }

      const rfaInterface = await remoteAPI.connect();

      if (opts.remoteDebugging) {
        // await fixSourceMappings(pluginBuild.initialOptions.outdir!);
      }

      await runExtensions(extensions.afterBuild, rfaInterface, result.metafile!);

      const filesWithRAM = await upload(outdir, rfaInterface);

      const formatOutputFiles = (files: typeof filesWithRAM) => {
        return files.map((file) =>
          `  \x1b[33m•\x1b[0m ${file.server}://${file.filename} ${
            file.cost ? `\x1b[32mRAM: ${file.cost}GB\x1b[0m` : ''
          }`
        );
      };

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
  const errors: any[] = [];

  await Promise.all(
    extensions
      .map(async (ext) => ext(...args))
      .map((ext) => ext.catch((e) => errors.push(e.error ?? JSON.stringify(e)))),
  );

  for (const error of errors) console.error(error);
}

async function upload(outdir: string, remoteAPI: RemoteApiInterface) {
  const t = await Array.fromAsync(walk(outdir, { includeSymlinks: false }));

  const rawFiles = (await Array.fromAsync(walk(outdir, { includeSymlinks: false })))
    .filter((file) => file.isFile)
    .map((file) => ({
      name: file.name,
      path: file.path.replaceAll('\\', '/').replace(/^.*?\//, ''), // rebase path
    }))
    .map((file) => ({
      server: file.path.split('/')[0]!,
      filename: `${file.path}/${file.name}`.replace(/^.*?\//, ''),
      path: `${outdir}/${file.path}/${file.name}`,
    }));

  const logger = createLogBatch();

  const validServers = await rawFiles.reduce(async (prev, { server }) => {
    return prev.then(async (prev) => {
      if (prev[server]) return prev;
      prev[server] = await remoteAPI.getFileNames(server).then((_) => true).catch((
        _,
      ) => false);
      if (!prev[server]) {
        logger.warn(
          `Invalid server '${server}': ignoring files to be pushed to '${server}'`,
        );
      }
      return prev;
    });
  }, Promise.resolve({} as Record<string, boolean>));

  const files = rawFiles.filter((f) => validServers[f.server]);

  const failed_files: { filename: string; server: string }[] = [];

  await Promise.all(
    files.map(async ({ filename, server, path }) =>
      remoteAPI.pushFile({
        filename,
        server,
        content: await Deno.readTextFile(path),
      }).then((result) => {
        result.error().map((error) => {
          logger.error(`Can not push "${filename}" to "${server}": ${error}`);
          failed_files.push({ filename, server });
        });
      })
    ),
  );

  logger.dispatch();

  return Promise.all(
    files
      .filter((file) =>
        !failed_files.find(
          (failed_file) => (file.filename == failed_file.filename &&
            file.server == failed_file.server),
        )
      )
      .map(async ({ filename, server }) => ({
        filename,
        server,
        cost: await remoteAPI.calculateRAM({ filename, server })
          .then((response) => response.unwrapOr(0)),
      })),
  );
}

export interface LogBatcher {
  logs: any[][];
  log(...args: Parameters<typeof console['log']>): this;
  error(...args: string[]): this;
  warn(...args: string[]): this;
  dispatch(): void;
}

export function createLogBatch(): LogBatcher {
  return {
    logs: [] as any[][],
    log(...args: Parameters<typeof console['log']>) {
      this.logs.push(args);
      return this;
    },
    error(...messages: string[]) {
      this.logs.push(
        formatMessagesSync(
          messages.map((text) => ({ text })),
          { kind: 'error', color: true },
        ).map((message) => message.trimEnd()),
      );
      return this;
    },
    warn(...messages: string[]) {
      this.logs.push(
        formatMessagesSync(
          messages.map((text) => ({ text })),
          { kind: 'warning', color: true },
        ).map((message) => message.trimEnd()),
      );
      return this;
    },
    dispatch() {
      while (this.logs.length) {
        console.log(...this.logs.shift()!);
      }
    },
  };
}
