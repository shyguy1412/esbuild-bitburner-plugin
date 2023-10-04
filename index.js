const http = require('http');
const WebSocketServer = require('websocket').server;


/** @type {(opts:import('./index').BitburnerPluginOptions) => import('esbuild').Plugin} */
const BitburnerPlugin = (opts) => ({
  name: "BitburnerPlugin",
  setup(pluginBuild){
    opts ??= {};
    pluginBuild.initialOptions.metafile = true;
    
    if(!opts.port)
      throw new Error('No port provided');

    //if(pluginBuild.initialOptions.write)
    //  throw new Error("BitburnerPlugin doesn't support 'write' mode");

    const RemoteAPI = (() => {
      const remote = {
        write: function(obj){
          return new Promise((resolve) => {
            const id = Date.now();
            const message = JSON.stringify({
              "jsonrpc": "2.0",
                id,
                ...obj 
            });
            
            const handler = (e) => {
              const response = JSON.parse(e.utf8Data);
              if(response.id == id){
                this.connection.removeListener('message', handler);
                resolve(response);
              }
            }

            this.connection.addListener('message', handler);
            this.connection.send(message);
          });
        }
      }

      const server = http.createServer((request, response) => {
        response.writeHead(404);
        response.end();
      });
    
      server.listen(opts.port, () => {
        console.log('✅ RemoteAPI Server listening on port ' + opts.port);
      });

      const wsServer = new WebSocketServer({
        httpServer: server,
        autoAcceptConnections: false,
        maxReceivedMessageSize: 1.49e+7,
        maxReceivedFrameSize: 1.49e+7
      });

    
      wsServer.on('request', async function(request) {
        var connection = request.accept(null, request.origin);
        remote.connection = connection;
        connection.on('close', (e) => {
          console.log(e);
        });
        connection.on('message', (e) => {
          console.log(e);
        });
      });

      return remote;
    })();

    pluginBuild.onEnd(async (result) => {
      console.log(result.metafile);
      return;
      const files = Object.values(result.metafile.outputs)
        .map(([path, value]) => {
          return {
            name: path,
            server: 'home',
            content: value
          }
      });
      async function pushFiles(files){
        return Promise.all(files.map(async file => RemoteAPI.write({
            "method": "pushFile",
            "params": {
              filename: file.name,
              content: file.content,
              server: file.server,
            }
        })));
        for(const file of files){
          await RemoteAPI.write({
          });
        }
      }

      async function calculateRAM(files){
        return await Promise.all(files.map(async file => ({
          name: file.name,
          server: file.server,
          cost: await RemoteAPI.write()
        })));
      }

    })
  }
});




module.exports = {
  default: BitburnerPlugin,
  BitburnerPlugin
}
