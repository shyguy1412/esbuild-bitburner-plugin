const RemoteApiServer = require('./RemoteApiServer');
const fs = require('fs/promises');
const { existsSync } = require('fs');

/** @type RemoteApiServer */
let remoteAPI;

/** @type {(opts:import('./index').BitburnerPluginOptions) => import('esbuild').Plugin} */
const BitburnerPlugin = (opts) => ({
  name: "BitburnerPlugin",
  setup(pluginBuild) {
    opts ??= {};

    const { outdir } = pluginBuild.initialOptions;

    if (!opts.port)
      throw new Error('No port provided');

    if (pluginBuild.initialOptions.write)
      throw new Error("BitburnerPlugin doesn't support 'write' mode");

    if (!outdir)
      throw new Error("BitburnerPlugin requires the outdir option to be set");

    if (!remoteAPI)
      remoteAPI = new RemoteApiServer();

    remoteAPI.listen(opts.port, () => {
      console.log('✅ RemoteAPI Server listening on port ' + opts.port);
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.types) return;
      const types = await remoteAPI.getDefinitionFile();
      await fs.writeFile(opts.types, types.result);
    });

    remoteAPI.on('client-connected', async () => {
      if (!opts.distribute) return;

      for (const path in opts.distribute) {
        remoteAPI.distribute(path, ...opts.distribute[path]);
      }
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
    let startTime;

    pluginBuild.onStart(async () => {
      startTime = Date.now();
      if (existsSync(outdir))
        await fs.rm(outdir, { recursive: true });
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
      if (!existsSync(outdir)) {
        console.log('No files have been output!');
        return;
      }

      let endTime = Date.now();
      if (!remoteAPI.connection || !remoteAPI.connection.connected) {
        queued = true;
        console.log('Waiting for client to connect');
        await new Promise(resolve => {
          remoteAPI.on('client-connected', () => {
            console.log('Client connected');
            resolve();
          });
        });
      }



      const files = (await fs.readdir(outdir, { recursive: true, withFileTypes: true }))
        .filter(file => file.isFile())
        .map(file => { file.path = file.path.replaceAll('\\', '/').replace(/^.*?\//, ''); return file; }) // rebase path
        .map(file => ({
          server: file.path.split('/')[0],
          filename: `${file.path}/${file.name}`.replace(/^.*?\//, ''),
          path: `${outdir}/${file.path}/${file.name}`
        }));

      console.log(files);

      const promises = files
        .map(async ({ filename, server, path }) => remoteAPI.pushFile({
          filename,
          server,
          content: (await fs.readFile(path)).toString('utf8')
        }));

      await Promise.all(promises);

      const formatOutputFiles = (files) => {
        return files.map(file => `  \x1b[33m•\x1b[0m ${file.server}://${file.filename} \x1b[32mRAM: ${file.cost}GB\x1b[0m`);
      };

      const filesWithRAM = await Promise.all(files.map(async ({ filename, server }) => ({
        filename,
        server,
        cost: (await remoteAPI.calculateRAM({ filename, server })).result
      })));

      queued = false;

      console.log();
      console.log(formatOutputFiles(filesWithRAM).join('\n'));
      console.log();
      console.log(`⚡ \x1b[32mDone in \x1b[33m${endTime - startTime}ms\x1b[0m`);
      console.log();

      return;
    });

  }
});




module.exports = {
  default: BitburnerPlugin,
  BitburnerPlugin,
  remoteAPI,
};
