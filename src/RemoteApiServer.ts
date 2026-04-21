// import { err, ok, Result } from '@gnome/monads';

import { Result } from 'result';

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

    #httpHandler(request: Request) {
        if (request.headers.get('upgrade') != 'websocket') {
            return new Response(null, { status: 426 });
        }

        if (this.interface) {
            return new Response(null, { status: 403 });
        }

        const { socket, response } = Deno.upgradeWebSocket(request);

        this.interface = createInterface(socket);
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

export function write<M extends keyof RFAMethods>(
    socket: WebSocket,
    method: M,
    params: RFARequest<M>,
): Promise<Result<RFAResponse<M>['result'], RFAResponse<M>['error']>> {
    if (!socket) {
        return Promise.resolve(Result.Err('No open connection'));
    }

    const id = crypto.randomUUID();
    const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
    });

    socket.send(message);

    return new Promise((resolve) => {
        const abortController = new AbortController();

        const timeout = setTimeout(() => {
            abortController.abort();
            resolve(Result.Err('message timed out: ' + id));
        }, 1000);

        socket.addEventListener('message', (ev) => {
            const response = JSON.parse(ev.data);
            if (response.id != id) {
                return;
            }

            clearTimeout(timeout);

            if ('error' in response) {
                resolve(Result.Err(response['error']));
            } else {
                resolve(Result.Ok(response['result']));
            }
        }, { signal: abortController.signal });
    });
}

function createInterface(socket: WebSocket) {
    return new Proxy({} as RemoteApiInterface, {
        get(_, p: keyof RFAMethods | 'then') {
            if (p == 'then') { //prevent promise shenanigans
                return undefined;
            }

            return (params: RFAMethods[typeof p][0]) => write(socket, p, params);
        },
    });
}

type RemoteApiInterface = {
    [M in keyof RFAMethods]: (
        ...[params]: RFAMethods[M][0] extends never ? [] : [RFAMethods[M][0]]
    ) => Promise<Result<RFAResponse<M>['result'], RFAResponse<M>['error']>>;
};

export type RFAMethods = {
    getDefinitionFile: [GetDefinitionFileRequest, GetDefinitionFileResponse];
    pushFile: [PushFileRequest, PushFileResponse];
    getFile: [GetFileRequest, GetFileResponse];
    getFileNames: [GetFileNamesRequest, GetFileNamesResponse];
    getAllFiles: [GetAllFilesRequest, GetAllFilesResponse];
    deleteFile: [DeleteFileRequest, DeleteFileResponse];
    calculateRam: [CalculateRamRequest, CalculateRamResponse];
    getAllServers: [GetAllServersRequest, GetAllServersResponse];
    getSaveFile: [GetSaveFileRequest, GetSaveFileResponse];
    getFileMetaData: [GetFileMetaDataRequest, GetFileMetaDataResponse];
    getAllFileMetaData: [GetAllFileMetaDataRequest, GetAllFileMetaDataResponse];
};

export type RFARequest<M extends keyof RFAMethods> = RFAMethods[M][0];

export type RFAResponse<M extends keyof RFAMethods> = M extends keyof RFAMethods ? {
        jsonrpc: '2.0';
        id: number;
        result: RFAMethods[M][1];
        error: unknown;
    } :
    never;

type FileParameter = { filename: string; server: string };
type ServerParameter = { server: string };

export type PushFileRequest = { filename: string; content: string; server: string };
export type CalculateRamRequest = FileParameter;

export type GetDefinitionFileRequest = never;
export type GetAllServersRequest = never;
export type GetSaveFileRequest = never;

export type GetFileRequest = FileParameter;
export type GetAllFilesRequest = ServerParameter;
export type GetFileNamesRequest = ServerParameter;
export type GetFileMetaDataRequest = FileParameter;
export type GetAllFileMetaDataRequest = ServerParameter;
export type DeleteFileRequest = FileParameter;

export type PushFileResponse = 'OK';
export type CalculateRamResponse = number;

export type GetDefinitionFileResponse = string;
export type GetAllServersResponse = {
    hostname: string;
    hasAdminRights: boolean;
    purchasedByPlayer: boolean;
}[];
export type GetSaveFileResponse = {
    identifier: string;
    binary: boolean;
    save: string;
};

export type GetFileResponse = string;
export type GetAllFilesResponse = { filename: string; content: string }[];
export type GetFileNamesResponse = string[];
export type GetFileMetaDataResponse = {
    filename: string;
    atime: string;
    btime: string;
    mtime: string;
};
export type GetAllFileMetaDataResponse = GetFileMetaDataResponse[];
export type DeleteFileResponse = 'OK';

export type { RemoteApiInterface };
