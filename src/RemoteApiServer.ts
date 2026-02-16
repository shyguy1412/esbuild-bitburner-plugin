import { err, ok, Result } from '@gnome/monads';

export const CONTROLLER_SECRET = crypto.randomUUID();

export type RemoteApiServerOptions = {
    port?: number;
};

export class RemoteApiServer extends EventTarget {
    #server: Deno.HttpServer<Deno.NetAddr>;

    interface?: RemoteApiInterface;

    constructor(opts: RemoteApiServerOptions) {
        super();

        this.#server = Deno.serve({
            port: opts.port,
        }, this.#httpHandler.bind(this));
    }

    async #httpHandler(request: Request) {
        if (request.headers.get('upgrade') != 'websocket') {
            return new Response(null, { status: 426 });
        }

        if (this.interface) {
            return new Response(null, { status: 403 });
        }

        const { socket, response } = Deno.upgradeWebSocket(request);

        this.interface = new RemoteApiInterface(socket);
        socket.addEventListener('close', () => this.interface = undefined);

        socket.addEventListener(
            'open',
            () => this.dispatchEvent(new Event('client-connected')),
        );

        return response;
    }

    connect(): Promise<RemoteApiInterface> {
        if (this.interface) {
            return Promise.resolve(this.interface);
        }

        return new Promise((r) =>
            this.addEventListener('client-connected', () => r(this.interface!), {
                once: true,
            })
        );
    }

    shutdown() {
        return this.#server.shutdown();
    }
}

class RemoteApiInterface {
    #socket: WebSocket;

    constructor(socket: WebSocket) {
        this.#socket = socket;
    }

    write(obj: Record<string, any>): Promise<Result<any, string>> {
        if (!this.#socket) {
            return Promise.resolve(err('No open connection'));
        }

        const id = crypto.randomUUID();
        const message = JSON.stringify({
            jsonrpc: '2.0',
            id,
            ...obj,
        });

        this.#socket.send(message);

        return new Promise((resolve) => {
            const abortController = new AbortController();

            const timeout = setTimeout(() => {
                abortController.abort();
                resolve(err('message timed out: ' + id));
            }, 1000);

            abortController.signal.addEventListener('abort', () => clearTimeout(timeout));

            this.#socket?.addEventListener('message', (ev) => {
                const response = JSON.parse(ev.data);
                if (response.id != id) return;

                if ('error' in response) resolve(err(response));
                else resolve(ok(response));
            }, { signal: abortController.signal });
        });
    }

    getDefinitionFile(): Promise<Result<any, string>> {
        return this.write({
            method: 'getDefinitionFile',
        });
    }

    pushFile(
        { filename, content, server }: {
            filename: string;
            content: string;
            server: string;
        },
    ): Promise<Result<any, string>> {
        return this.write({
            method: 'pushFile',
            params: {
                filename,
                content,
                server,
            },
        });
    }

    getFile(
        { filename, server }: { filename: string; server: string },
    ): Promise<Result<any, string>> {
        return this.write({
            method: 'getFile',
            params: {
                filename,
                server,
            },
        });
    }

    getFileNames(server: string): Promise<Result<any, string>> {
        return this.write({
            method: 'getFileNames',
            params: {
                server,
            },
        });
    }

    getAllFiles(server: string): Promise<Result<any, string>> {
        return this.write({
            method: 'getAllFiles',
            params: {
                server,
            },
        });
    }

    deleteFile(
        { filename, server }: { filename: string; server: string },
    ): Promise<Result<any, string>> {
        return this.write({
            method: 'deleteFile',
            params: {
                filename,
                server,
            },
        });
    }

    calculateRAM(
        { filename, server }: { filename: string; server: string },
    ): Promise<Result<any, string>> {
        return this.write({
            method: 'calculateRam',
            params: {
                filename,
                server,
            },
        });
    }

    getAllServers(): Promise<Result<any, string>> {
        return this.write({
            method: 'getAllServers',
        });
    }
}

export type { RemoteApiInterface };
