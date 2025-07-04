import http from 'http';
import { RemoteFileMirror } from './RemoteFileMirror';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { watch as watchDirectory } from 'chokidar';
import { connection, type request, server as WebSocketServer } from 'websocket';
import { AddressInfo } from 'net';
import { createLogBatch } from './log';
import { BitburnerPluginOptions } from '../types';

function isUtf8(event: any): event is { type: 'utf8' } {
  return event.type === 'utf8';
}

export class RemoteApiServer extends WebSocketServer {
  #counter;
  #queue;
  options: BitburnerPluginOptions;
  connection: connection | undefined;
  connected: Promise<void>;

  constructor(options: BitburnerPluginOptions) {
    super({
      httpServer: http.createServer((request, response) => {
        response.writeHead(404);
        response.end();
      }),
      autoAcceptConnections: false,
      maxReceivedMessageSize: 1.49e+7,
      maxReceivedFrameSize: 1.49e+7,
    });

    this.#queue = new Map<number, [(arg: any) => void, (arg: any) => void]>();
    this.#counter = 1;
    this.options = options;
    RemoteFileMirror.remoteApi = this;

    this.connected = new Promise<void>((resolve) => {
      this.once('client-connected', () => {
        console.log('Client connected');
        resolve();
      });
    });
  }

  // Events
  on(event: 'request', cb: (request: request) => void): this;
  on(event: 'connect', cb: (connection: connection) => void): this;
  on(
    event: 'close',
    cb: (connection: connection, reason: number, desc: string) => void,
  ): this;
  on(event: 'client-connected', cb: () => void): this;
  on(event: string, cb: (...arg: any) => void): this {
    super.on(event as any, cb);
    return this;
  }

  createMessageId() {
    return ++this.#counter;
  }

  listen(port: number, callback: () => void) {
    if (!this.config) throw new Error('Websocket not initilized');

    const httpServer = (this.config.httpServer as http.Server[])[0]!;

    if (httpServer.listening) {
      console.log(
        'WARNING: RemoteAPI Server is already listening on port ' +
          (httpServer.address() as AddressInfo).port,
      );
      return;
    }

    httpServer.listen(port, callback);

    this.on('request', async (request) => {
      if (this.connection && this.connection.connected) {
        request.reject(400, 'Only one client can connect at a time');
        return;
      }

      this.connection = request.accept(null, request.origin);

      this.connection.on('message', (e) => {
        if (!isUtf8(e)) {
          throw new Error('Unexpected binary data message');
        }

        const response = JSON.parse(e.utf8Data);
        if (this.#queue.has(response.id)) {
          this.#queue.get(response.id)![+('error' in response)]!(response);
          this.#queue.delete(response.id);
        }
      });

      this.emit('client-connected');
    });
  }

  mirror(
    targetPath: string,
    servers: NonNullable<BitburnerPluginOptions['mirror']>[string],
  ) {
    return RemoteFileMirror.create(targetPath, servers, this.options);
  }

  distribute(
    targetPath: string,
    to: NonNullable<BitburnerPluginOptions['mirror']>[string],
  ) {
    //listen to new files in targetPath
    const distributor = watchDirectory(targetPath, {
      ignoreInitial: true,
      usePolling: this.options.usePolling,
      interval: this.options.pollingInterval,
    });
    distributor.on('all', async (e, filePath) => {
      if (e != 'add' && e != 'change' || !(await fs.stat(filePath)).isFile()) return;

      const logger = createLogBatch();
      const santizedFilePath = filePath.replaceAll('\\', '/'); //deal with windows
      const content = (await fs.readFile(filePath)).toString('utf8');
      const servers = typeof to == 'string'
        ? await RemoteFileMirror.remoteApi.getAllServers()
          .then(({ result }) =>
            (result as any[])
              .filter((s) =>
                s.hasAdminRights && (to == 'own'
                  ? s.purchasedByPlayer
                  : to == 'other'
                  ? !s.purchasedByPlayer
                  : true)
              )
              .map((s) => s.hostname as string)
          )
          .catch((e) => {
            console.error(e);
            createLogBatch().error(
              JSON.stringify(e),
              `\nFailed to get distribution servers (${targetPath})`,
            ).dispatch();
            return [];
          })
        : to;

      if (!servers) return;

      console.log(`Distributing file ${filePath} to [${servers.join(', ')}]`);

      await Promise.allSettled(servers.map((server) =>
        this.pushFile({
          filename: santizedFilePath.replace(targetPath, ''), //strip basepath
          server,
          content,
        })
      )).catch((e) => logger.warn(e.error ?? JSON.stringify(e)).dispatch());
    });

    return () => {
      distributor.close();
    };
  }

  write(obj: Record<string, any>): Promise<{ result: any }> {
    return new Promise((resolve, reject) => {
      if (!this.connection || !this.connection.connected) {
        reject('No open connection');
        return;
      }
      const id = this.createMessageId();
      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        ...obj,
      });

      this.#queue.set(id, [resolve, reject]);

      this.connection.send(message);

      setTimeout(() => reject('message timed out'), 10000);
    });
  }

  getDefinitionFile() {
    return this.write({
      method: 'getDefinitionFile',
    });
  }

  pushFile(
    { filename, content, server }: { filename: string; content: string; server: string },
  ) {
    return this.write({
      method: 'pushFile',
      params: {
        filename,
        content,
        server,
      },
    });
  }

  getFile({ filename, server }: { filename: string; server: string }) {
    return this.write({
      method: 'getFile',
      params: {
        filename,
        server,
      },
    });
  }

  getFileNames(server: string) {
    return this.write({
      method: 'getFileNames',
      params: {
        server,
      },
    });
  }

  getAllFiles(server: string) {
    return this.write({
      method: 'getAllFiles',
      params: {
        server,
      },
    });
  }

  deleteFile({ filename, server }: { filename: string; server: string }) {
    return this.write({
      method: 'deleteFile',
      params: {
        filename,
        server,
      },
    });
  }

  calculateRAM({ filename, server }: { filename: string; server: string }) {
    return this.write({
      method: 'calculateRam',
      params: {
        filename,
        server,
      },
    });
  }

  getAllServers() {
    return this.write({
      method: 'getAllServers',
    });
  }
}

export function setupRemoteApi(opts: BitburnerPluginOptions) {
  const remoteAPI = new RemoteApiServer(opts);

  remoteAPI.on('client-connected', async () => {
    if (!opts.types) return;
    const types = await remoteAPI.getDefinitionFile();
    await fs.writeFile(opts.types, types.result);
  });

  remoteAPI.on('client-connected', async () => {
    if (!opts.distribute) return;

    for (const path in opts.distribute) {
      const distribute = opts.distribute[path]!;

      const dispose = remoteAPI.distribute(
        path.replaceAll('\\', '/'),
        distribute,
      );

      remoteAPI.addListener('close', () => dispose());
    }
  });

  remoteAPI.on('client-connected', async () => {
    if (!opts.mirror) return;

    const mirrors = [];

    for (const path in opts.mirror) {
      if (!existsSync(path)) {
        await fs.mkdir(path, { recursive: true });
      }

      const servers = opts.mirror[path]!;
      const mirror = await remoteAPI.mirror(
        path.replaceAll('\\', '/'),
        servers,
      );
      remoteAPI.addListener('close', () => mirror.dispose());

      mirrors.push(mirror);
    }

    for (const mirror of mirrors) {
      await mirror.initFileCache();
    }

    for (const mirror of mirrors) {
      if (opts.pushOnConnect) {
        await mirror.pushAllFiles();
      } else {
        await mirror.syncWithRemote();
      }
    }

    for (const mirror of mirrors) {
      mirror.watch();
    }
  });

  return remoteAPI;
}
