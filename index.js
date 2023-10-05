const RemoteApiServer = require('./RemoteApiServer');
const fs = require('fs/promises');

/** @type {(opts:import('./index').BitburnerPluginOptions) => import('esbuild').Plugin} */
const BitburnerPlugin = (opts) => ({
  name: "BitburnerPlugin",
  setup(pluginBuild){
    opts ??= {};
    opts.servers ??= [];

    const { outdir, outbase } = pluginBuild.initialOptions;
    
    if(!opts.port)
      throw new Error('No port provided');

    if(pluginBuild.initialOptions.write)
      throw new Error("BitburnerPlugin doesn't support 'write' mode");

    if(!outdir)
      throw new Error("BitburnerPlugin requires the outdir option to be set");

    const remoteAPI = new RemoteApiServer(opts.port);

    remoteAPI.listen(opts.port, () => {
      console.log('✅ RemoteAPI Server listening on port ' + opts.port);
    })

    remoteAPI.on('client-connected', async () => {
      if(!opts.types) return;
      const types = await remoteAPI.getDefinitionFile();
      await fs.writeFile(opts.types, types.result);
    });

    let queued = false;
    let startTime;

    pluginBuild.onStart(() => {
      startTime = Date.now();
    });

    pluginBuild.onResolve({filter: /^react(-dom)?$/}, (opts) => {
      console.log(opts);
      return {
        namespace: 'react',
        path: opts.path,
      }
    });

    //Listener for error message and information
    pluginBuild.onEnd(result => {
      if(!result.errors.length && !result.warnings.length) return;
      const highlightText = (text, start, end) => {
        const before = text.substring(0, start);
        const toHighlight = text.substring(start, end);
        const highlighted = `\x1b[92m${toHighlight}\x1b[0m`;
        const after = text.substring(end);
        return before + highlighted + after + `\n` +
          //squiggles
          before.replaceAll(/./g, ' ') +
          `\x1b[92m${toHighlight.replaceAll(/./g, '~')}\x1b[0m`
        ;
      };

      const formatMessage = (m, error = true) => {
        const message =
          `${error ? '❌' : '⚠️'} \x1b[41m\x1b[97m[${error?'ERROR':'WARNING'}]\x1b[0m ` +
          `${m.text}\n\n` +
          `    ${m.location?.file ?? 'source'}:${m.location?.line ?? 'unknown'}:${m.location?.column ?? 'unknown'}:\n` +
          `      ${m.location?.lineText ?
            highlightText(
              m.location.lineText,
              m.location.column ?? 0,
              (m.location.column ?? 0) + (m.location.length ?? 0)).replace('\n', '\n      ')
            : ''}`;

          return message;
      };


      if(result.errors.length)
        result.errors.forEach(e => console.log(formatMessage(e)));
      if(result.warnings.length)
        result.warnings.forEach(e => console.log(formatMessage(e)));


      console.log(`${result.errors.length ? '❌' : '✅'} ${result.errors.length} ${result.errors.length == 1 ? 'error' : 'errors'}`);
      console.log(`${result.warnings.length ? '⚠️' : '✅'} ${result.warnings.length} ${result.warnings.length == 1 ? 'warning' : 'warnings'}`);

      // console.log(result.errors[0]);

    });

    pluginBuild.onEnd(async (result) => {
      if(result.errors.length != 0)return;
      if(queued)return;
      let endTime = Date.now();
      if(!remoteAPI.connection || !remoteAPI.connection.connected){
        queued = true;
        console.log('Waiting for client to connect')
        await new Promise(resolve => {
          remoteAPI.on('client-connected', () => resolve());
        });
      }

      const files = (await fs.readdir(outdir, {recursive:true, withFileTypes: true}))
        .filter(file => file.isFile())
        .map(file => {file.path = file.path.replace('\\', '/').replace(/^.*?\//, '');return file}) // rebase path
        .map(file => ({
            server: file.path.split('/')[0],
            filename: `${file.path}/${file.name}`.replace(/^.*?\//, ''),
            path:`${outdir}/${file.path}/${file.name}` 
        }));

      const promises = files
        .map(async ({filename, server, path}) => remoteAPI.pushFile({
            filename,
            server,
            content: (await fs.readFile(path)).toString('utf8')
        }));

      await Promise.all(promises);

      const formatOutputFiles = (files) => {
        return files.map(file => `  \x1b[33m•\x1b[0m ${file.server}://${file.filename} \x1b[32mRAM: ${file.cost}GB\x1b[0m`);
      };


      const filesWithRAM = await Promise.all(files.map(async ({filename, server}) => ({
        filename, 
        server,
        cost: (await remoteAPI.calculateRAM({filename, server})).result
      })));

      queued = false;
      
      if(pluginBuild.initialOptions.logLevel != 'info') return;

      console.log();
      console.log(formatOutputFiles(filesWithRAM).join('\n'));
      console.log();
      console.log(`⚡ \x1b[32mDone in \x1b[33m${endTime - startTime}ms\x1b[0m`);
      console.log();

      return;
    })
  }
});




module.exports = {
  default: BitburnerPlugin,
  BitburnerPlugin
}
