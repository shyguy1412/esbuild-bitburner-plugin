import { Plugin, formatMessages } from "esbuild";
import { RemoteApiServer } from './RemoteApiServer';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { RemoteFileMirror } from "./RemoteFileMirror";
import { createLogBatch } from "./lib/log";

export type BitburnerPluginOptions = Partial<{
  /**
   * This is the port the RemoteAPI will connect to.  
   * Enter the same port inside your game options to connect to your editor.
   */
  port: number;
  /**
   * This is the path that the Netscript Definitions file will be placed at.
   */
  types: string;
  /**
   * Set this to true to poll the filessytem instead of using filesystem events.  
   * This can fix issues when using WSL but having the project inside the Windows filesystem.
   */
  usePolling: boolean;
  /**
   * Sets the interval for the filesystem polling
   * Only used when usePolling is set to true.  
   */
  pollingInterval: number;
  /**
   * Set this to true to push mirrored files on connect.  
   * By default the file mirror pulls the ingame files on connect, overriding local files with the current ingame state.  
   */
  pushOnConnect: boolean;
  /**
   * Use this to map a local directory to a list of ingame servers.  
   * All the listed servers will be mirrored into that directory.  
   */
  mirror: {
    [path: string]: string[] | 'all';
  };
  /**
   * Use this to map a local directory to multiple servers.  
   * All files in that directory will be uploaded to all of the listed servers.  
   */
  distribute: {
    [path: string]: string[] | 'all';
  };
  /**
   * A list of extensions for the Plugin to supplement and customize features.
   */
  extensions: {
    setup?: () => void | Promise<void>;

    beforeConnect?: () => void | Promise<void>;
    afterConnect?: (remoteAPI: RemoteApiServer) => void | Promise<void>;

    beforeBuild?: () => void | Promise<void>;
    afterBuild?: (remoteAPI: RemoteApiServer) => void | Promise<void>;
  }[];
}>;

export type PluginExtension = NonNullable<BitburnerPluginOptions['extensions']>[number];
export type { RemoteApiServer, RemoteFileMirror };

export const BitburnerPlugin: (opts: BitburnerPluginOptions) => Plugin = (opts = {}) => ({
  name: "BitburnerPlugin",
  async setup(pluginBuild) {

    const logLevel = pluginBuild.initialOptions.logLevel;
    if (!['verbose', 'debug'].includes(logLevel!)) {
      pluginBuild.initialOptions.logLevel = 'silent';
    }

    if (typeof opts != 'object') {
      throw new TypeError('Expected options to be an object');
    }; //Ensure opts is an object

    const { outdir } = pluginBuild.initialOptions;

    const extensions = (opts.extensions ?? []).reduce((prev, cur) => {
      for (const key in prev) {
        const extension = cur[key as keyof PluginExtension];
        if (extension)
          //TS struggles to understand that extension is the right type
          //since this is iterating over keys, this is the best I can do for now 
          prev[key as keyof PluginExtension].push(extension as any);
      }
      return prev;
    }, {
      setup: [],
      beforeConnect: [],
      afterConnect: [],
      beforeBuild: [],
      afterBuild: [],
    } as { [key in keyof Required<PluginExtension>]: NonNullable<PluginExtension[key]>[] });

    const remoteAPI = new RemoteApiServer(opts);

    pluginBuild.onDispose(() => {
      remoteAPI.shutDown();
    });

    await runExtensions(extensions.setup);

    if (!opts.port)
      throw new Error('No port provided');

    if (pluginBuild.initialOptions.write)
      throw new Error("BitburnerPlugin doesn't support 'write' mode");

    if (!outdir)
      throw new Error("BitburnerPlugin requires the outdir option to be set");

    remoteAPI.listen(opts.port, () => {
      console.log('✅ RemoteAPI Server listening on port ' + opts.port);
    });

    await runExtensions(extensions.beforeConnect);

    remoteAPI.on('client-connected', async () => {
      await runExtensions(extensions.afterConnect, remoteAPI);
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.types) return;
      const types = await remoteAPI.getDefinitionFile();
      await fs.writeFile(opts.types, types.result);
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.distribute) return;

      for (const path in opts.distribute) {
        const distribute = opts.distribute[path];

        const dispose = distribute == 'all' ?
          remoteAPI.distribute(path.replaceAll('\\', '/'), distribute) :
          remoteAPI.distribute(path.replaceAll('\\', '/'), opts.distribute[path]);

        remoteAPI.addListener('close', () => dispose());
      }
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.mirror) return;

      const mirrors = [];

      for (const path in opts.mirror) {
        if (!existsSync(path))
          await fs.mkdir(path, { recursive: true });

        const servers = opts.mirror[path];
        const mirror = await remoteAPI.mirror(path.replaceAll('\\', '/'), servers);
        remoteAPI.addListener('close', () => mirror.dispose());

        mirrors.push(mirror);
      }

      for (const mirror of mirrors) {
        await mirror.initFileCache();
      }

      for (const mirror of mirrors) {
        if (opts.pushOnConnect)
          await mirror.pushAllFiles();
        else
          await mirror.syncWithRemote();
      }

      for (const mirror of mirrors) {
        mirror.watch();
      }
    });

    let queued = false;
    let startTime: number;

    pluginBuild.onStart(async () => {
      startTime = Date.now();
      if (existsSync(outdir))
        await fs.rm(outdir, { recursive: true });
      await runExtensions(extensions.beforeBuild);
    });

    pluginBuild.onResolve({ filter: /^react(-dom)?$/ }, (opts) => {
      return {
        namespace: 'react',
        path: opts.path,
      };
    });

    pluginBuild.onLoad({ filter: /^react(-dom)?$/, namespace: 'react' }, (opts) => {
      if (opts.path == 'react')
        return {
          contents: 'module.exports = window.React'
        };
      else if (opts.path == 'react-dom')
        return {
          contents: 'module.exports = window.ReactDOM'
        };
    });

    pluginBuild.onEnd(async (result) => {
      if (!result.errors.length && !result.warnings.length) return;
      if (['silent', 'verbose', 'debug'].includes(logLevel!)) return;

      const warnings = await formatMessages(result.warnings, { kind: 'warning', color: true });
      const errors = await formatMessages(result.errors, { kind: 'error', color: true });

      while (warnings.length && logLevel != 'error') {
        console.log(warnings.shift()?.trimEnd());
        console.log();
      }

      while (errors.length) {
        console.log(errors.shift()?.trimEnd());
        console.log();
      }

    });

    pluginBuild.onEnd(async (result) => {
      if (result.errors.length != 0) return;
      if (queued) return;
      const logger = createLogBatch();
      try {

        const endTime = Date.now();
        if (!remoteAPI.connection || !remoteAPI.connection.connected) {
          queued = true;
          console.log('Build successful, waiting for client to connect');
          await new Promise<void>(resolve => {
            remoteAPI.prependListener('client-connected', () => {
              console.log('Client connected');
              resolve();
            });
          });
        }

        await runExtensions(extensions.afterBuild, remoteAPI);

        const rawFiles = (await fs.readdir(outdir, { recursive: true, withFileTypes: true }))
          .filter(file => file.isFile())
          .map(file => ({
            name: file.name,
            path: file.path.replaceAll('\\', '/').replace(/^.*?\//, '') // rebase path
          }))
          .map(file => ({
            server: file.path.split('/')[0],
            filename: `${file.path}/${file.name}`.replace(/^.*?\//, ''),
            path: `${outdir}/${file.path}/${file.name}`
          }));

        const validServers = await rawFiles.reduce(async (prev, { server }) => {
          return prev.then(async prev => {
            if (prev[server]) return prev;
            prev[server] = await remoteAPI.getFileNames(server).then(_ => true).catch(_ => false);
            if (!prev[server]) logger.warn(`Invalid server '${server}': ignoring files to be pushed to '${server}'`);
            return prev;
          });
        }, Promise.resolve({} as Record<string, boolean>));

        const files = rawFiles.filter(f => validServers[f.server]);

        await Promise.all(
          files.map(async ({ filename, server, path }) => remoteAPI.pushFile({
            filename,
            server,
            content: (await fs.readFile(path)).toString('utf8')
          }))
        );

        const filesWithRAM = await Promise.all(files.map(async ({ filename, server }) => ({
          filename,
          server,
          cost: (await remoteAPI.calculateRAM({ filename, server })).result
        })));

        const formatOutputFiles = (files: typeof filesWithRAM) => {
          return files.map(file => `  \x1b[33m•\x1b[0m ${file.server}://${file.filename} \x1b[32mRAM: ${file.cost}GB\x1b[0m`);
        };

        logger.dispatch();
        console.log();
        console.log(formatOutputFiles(filesWithRAM).join('\n'));
        console.log();
        console.log(`⚡ \x1b[32mDone in \x1b[33m${endTime - startTime}ms\x1b[0m`);
        console.log();
      } catch (e) {
      } finally {
        queued = false;
        logger.dispatch();
      }
    });
  }
});

async function runExtensions<T extends (...args: any[]) => any>(extensions: T[], ...args: Parameters<T>) {
  const logger = createLogBatch();
  for (const extension of extensions) {
    await Promise.resolve(extension(...args))
      .catch(e => logger.error(e.error ?? JSON.stringify(e)));
  }
  logger.dispatch();
}