const {log} = require('console');
const http = require('http');
const WebSocketServer = require('websocket').server;
const fs = require('fs/promises');
const path = require('path');
const pathExists = require('fs').existsSync;


class RemoteApiServer extends WebSocketServer {

  #counter;

  constructor() {
    super({
      httpServer: http.createServer((request, response) => {
        response.writeHead(404);
        response.end();
      }),
      autoAcceptConnections: false,
      maxReceivedMessageSize: 1.49e+7,
      maxReceivedFrameSize: 1.49e+7
    });

    this.queue = new Map();
    this.#counter = 1;
  }

  getId() {
    return ++this.#counter;
  }

  listen(port, callback) {

    if (this.config.httpServer[0].listening) {
      return;
    }

    this.config.httpServer[0].listen(port, callback);

    this.on('request', async (request) => {
      if (this.connection && this.connection.connected) {
        request.reject(400, "Only one client can connect at a time");
        return;
      }

      this.connection = request.accept(null, request.origin);

      this.connection.on('message', (e) => {
        const response = JSON.parse(e.utf8Data);
        if (this.queue.has(response.id)) {
          this.queue.get(response.id)(response);
          this.queue.delete(response.id);
        }
      });
      
      this.emit('client-connected');

    });
  }

  mirror(targetPath, ...servers){
    let syncing = false;

    const getAllServerFiles = async () => {
      const files = [];
      for (const server of servers){
        const serverFiles = (await this.getAllFiles(server)).result;
        if(!serverFiles)continue;
        files.push(...serverFiles.map(file => ({
          filename: file.filename,
          server,
          content: file.content
        })));
      }
      return files;
    }

    return {
      dispose(){

      },
      async syncWithRemote(){
        syncing = true;
        console.log('getting files')
        const files = await getAllServerFiles();
        for(const file of files){
          const filePath = path.join(targetPath, file.server, file.filename);
          
          if(!pathExists(path.dirname(filePath)))
            await fs.mkdir(path.dirname(filePath), {recursive: true});

          await fs.writeFile(filePath, file.content);
        }
        syncing = false;
      },
      watch(){
        
      }
    }
  }

  write(obj) {
    return new Promise((resolve, reject) => {
      if (!this.connection || !this.connection.connected) {
        reject("No open connection");
        return;
      }
      const id = this.getId();
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...obj
      });

      this.queue.set(id, resolve);

      this.connection.send(message);

      setTimeout(() => reject('message timed out'), 10000);
    });
  }

  getDefinitionFile() {
    return this.write({
      method: "getDefinitionFile"
    });
  }

  pushFile({ filename, content, server }) {
    return this.write({
      method: "pushFile",
      params: {
        filename,
        content,
        server
      }
    });
  }

  getFile({ filename, server }) {
    return this.write({
      method: "getFile",
      params: {
        filename,
        server,
      }
    });
  }

  getFileNames(server) {
    return this.write({
      method: "getFileNames",
      params: {
        server,
      }
    });
  }

  getAllFiles(server) {
    return this.write({
      method: "getAllFiles",
      params: {
        server,
      }
    });
  }

  deleteFile({ filename, server }) {
    return this.write({
      method: "deleteFile",
      params: {
        filename,
        server,
      }
    });
  }

  calculateRAM({ filename, server }) {
    return this.write({
      method: "calculateRam",
      params: {
        filename,
        server,
      }
    });
  }

}

module.exports = RemoteApiServer;

