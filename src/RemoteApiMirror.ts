import type { RemoteApiInterface } from './RemoteApiServer.ts';

export type RemoteApiMirrorOptions = {
    targetDirectory: string;
    servers: string[] | 'all' | 'own' | 'npc';
};

export type ResolvedRemoteApiMirrorOptions = RemoteApiMirrorOptions & {
    servers: string[];
};

export class RemoteApiMirror {
    #remoteApi: RemoteApiInterface;
    servers: string[];

    constructor(remoteApi: RemoteApiInterface, opts: ResolvedRemoteApiMirrorOptions) {
        this.#remoteApi = remoteApi;

        this.servers = opts.servers;

        console.log(
            `Creating mirror [${this.servers.join(', ')}] => ${opts.targetDirectory}`,
        );
    }

    static async init(remoteApi: RemoteApiInterface, opts: RemoteApiMirrorOptions) {
        const resolvedOptions: ResolvedRemoteApiMirrorOptions = {
            ...opts,
            servers: await resolveServersOption(opts.servers, remoteApi),
        };
        return new RemoteApiMirror(remoteApi, resolvedOptions);
    }
}

async function resolveServersOption(
    opt: RemoteApiMirrorOptions['servers'],
    remoteApi: RemoteApiInterface,
) {
    if (typeof opt == 'object') {
        return opt;
    }

    const servers = (await remoteApi.getAllServers())
        .unwrapOr([]);

    return servers.filter((s) =>
        s.hasAdminRights &&
        (opt == 'own' ? s.purchasedByPlayer : opt == 'npc' ? !s.purchasedByPlayer : true)
    ).map((s) => s.hostname as string);
}
