const http = require('http');
const WebSocketServer = require('websocket').server;

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

  getFileNames({ server }) {
    return this.write({
      method: "getFileNames",
      params: {
        server,
      }
    });
  }

  getAllFiles({ server }) {
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

