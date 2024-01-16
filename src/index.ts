import { Plugin } from "esbuild";
import { RemoteApiServer } from './RemoteApiServer';
import fs from 'fs/promises';
import { existsSync } from 'fs';


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
    [path: string]: string[];
  };
  /**
   * Use this to map a local directory to multiple servers.  
   * All files in that directory will be uploaded to all of the listed servers.  
   */
  distribute: {
    [path: string]: string[];
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

    beforeDistribute?: (remoteAPI: RemoteApiServer) => void | Promise<void>;
    afterDistribute?: (remoteAPI: RemoteApiServer) => void | Promise<void>;
  }[];
}>;
export type PluginExtension = NonNullable<BitburnerPluginOptions['extensions']>[number];


export const BitburnerPlugin: (opts: BitburnerPluginOptions) => Plugin = (opts = {}) => ({
  name: "BitburnerPlugin",
  async setup(pluginBuild) {

    if (typeof opts != 'object') {
      throw new TypeError('Expected options to be an object');
    }; //Ensure opts is an object

    const { outdir } = pluginBuild.initialOptions;
    const extensions = opts.extensions ?? [];
    const remoteAPI = new RemoteApiServer(opts);

    pluginBuild.onDispose(() => {
      remoteAPI.shutDown();
    });

    await Promise.allSettled(extensions.map(e => callNullableFunction(e.setup)));

    if (!opts.port)
      throw new Error('No port provided');

    if (pluginBuild.initialOptions.write)
      throw new Error("BitburnerPlugin doesn't support 'write' mode");

    if (!outdir)
      throw new Error("BitburnerPlugin requires the outdir option to be set");

    remoteAPI.listen(opts.port, () => {
      console.log('✅ RemoteAPI Server listening on port ' + opts.port);
    });

    await Promise.allSettled(extensions.map(e => callNullableFunction(e.beforeConnect)));

    remoteAPI.on('client-connected', () => {
      Promise.allSettled(extensions.map(e => callNullableFunction(e.afterConnect, remoteAPI)));
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.types) return;
      const types = await remoteAPI.getDefinitionFile();
      await fs.writeFile(opts.types, types.result);
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.distribute) return;

      await Promise.allSettled(extensions.map(e => callNullableFunction(e.beforeDistribute, remoteAPI)));

      for (const path in opts.distribute) {
        remoteAPI.distribute(path, ...opts.distribute[path]);
      }

      await Promise.allSettled(extensions.map(e => callNullableFunction(e.afterDistribute, remoteAPI)));
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.mirror) return;

      const mirrors = [];

      console.log();

      for (const path in opts.mirror) {
        if (!existsSync(path))
          await fs.mkdir(path, { recursive: true });

        const servers = opts.mirror[path];
        const mirror = remoteAPI.mirror(path, ...servers);
        remoteAPI.addListener('close', () => mirror.dispose());

        mirrors.push(mirror);
      }

      console.log();

      for (const mirror of mirrors) {
        await mirror.initFileCache();
      }

      console.log();

      for (const mirror of mirrors) {
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
      Promise.allSettled(extensions.map(e => callNullableFunction(e.beforeBuild)));
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
      if (result.errors.length != 0) return;
      if (queued) return;

      const endTime = Date.now();
      if (!remoteAPI.connection || !remoteAPI.connection.connected) {
        queued = true;
        console.log('Waiting for client to connect');
        await new Promise<void>(resolve => {
          remoteAPI.on('client-connected', () => {
            console.log('Client connected');
            resolve();
          });
        });
      }

      const files = (await fs.readdir(outdir, { recursive: true, withFileTypes: true }))
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

      if (files.length == 0) return;

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

      queued = false;

      console.log();
      console.log(formatOutputFiles(filesWithRAM).join('\n'));
      console.log();
      console.log(`⚡ \x1b[32mDone in \x1b[33m${endTime - startTime}ms\x1b[0m`);
      console.log();

      await Promise.allSettled(extensions.map(e => callNullableFunction(e.afterBuild, remoteAPI)));
    });

  }
});

function callNullableFunction<T extends (...args: any) => any>(func?: T, ...args: Parameters<T>): ReturnType<T> | void {
  return func ? func(...(args as [])) : undefined; //args is a rest parameter and therefore guranteed to be an array
};