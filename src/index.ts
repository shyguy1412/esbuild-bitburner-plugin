import {
    formatMessages,
    formatMessagesSync,
    type Metafile,
    type Plugin,
    PluginBuild,
} from 'esbuild';
import { type RemoteApiInterface, RemoteApiServer } from './RemoteApiServer.ts';
import { walk } from '@std/fs/walk';

export declare type BitburnerPluginOptions = {
    /**
     * This is the port the RemoteAPI will connect to.
     * Enter the same port inside your game options to connect to your editor.
     */
    port?: number;

    /**
     * This is the path that the Netscript Definitions file will be placed at.
     */
    types?: string;

    /**
     * Set this to true to poll the filessytem instead of using filesystem events.
     * This can fix issues when using WSL but having the project inside the Windows filesystem.
     */
    usePolling?: boolean;

    /**
     * Sets the interval for the filesystem polling
     * Only used when usePolling is set to true.
     */
    pollingInterval?: number;

    /**
     * Set this to true to push mirrored files on connect.
     * By default the file mirror pulls the ingame files on connect, overriding local files with the current ingame state.
     */
    pushOnConnect?: boolean;

    /**
     * Use this to map a local directory to a list of ingame servers.
     * All the listed servers will be mirrored into that directory.
     */
    mirror?: {
        [path: string]: string[] | 'all' | 'own' | 'other';
    };

    /**
     * Use this to map a local directory to multiple servers.
     * All files in that directory will be uploaded to all of the listed servers.
     */
    distribute?: {
        [path: string]: string[] | 'all' | 'own' | 'other';
    };

    /**
     * A list of extensions for the Plugin to supplement and customize features.
     */
    extensions?: {
        setup?: () => void | Promise<void>;

        beforeConnect?: () => void | Promise<void>;
        afterConnect?: (remoteAPI: RemoteApiInterface) => void | Promise<void>;

        beforeBuild?: () => void | Promise<void>;
        afterBuild?: (
            remoteAPI: RemoteApiInterface,
            meta: Metafile,
        ) => void | Promise<void>;
    }[];

    /**
     * runs esbuild plugins as preprocessors
     * preprocessors have considerable implications for build times
     */
    preprocessors?: Plugin[];

    /**
     * Enable remote debugging. This will automatically set the right esbuild options if they arent set already.
     */
    remoteDebugging?: boolean;
};

export type PluginExtension = NonNullable<
    BitburnerPluginOptions['extensions']
>[number];

function parseExtensions(extensions: BitburnerPluginOptions['extensions'] = []) {
    type Hooks = {
        [key in keyof Required<PluginExtension>]: Required<PluginExtension>[key][];
    };

    const hooks: Hooks = {
        setup: [],
        beforeConnect: [],
        afterConnect: [],
        beforeBuild: [],
        afterBuild: [],
    };

    for (const extension of extensions) {
        for (const key in extension) {
            const hookType = key as keyof PluginExtension;
            const hook = extension[hookType];
            //@ts-ignore shut up
            hooks[hookType as keyof PluginExtension].push(hook);
        }
    }

    return hooks;
}

const formatOutputFiles = (files: { server: string; filename: string; cost: number }[]) =>
    files.map((file) =>
        `  \x1b[33m•\x1b[0m ${file.server}://${file.filename} ${
            file.cost ? `\x1b[32mRAM: ${file.cost}GB\x1b[0m` : ''
        }`
    );

export const BitburnerPlugin: (opts: BitburnerPluginOptions) => Plugin = (
    opts = {},
) => ({
    name: 'BitburnerPlugin',
    setup: setup.bind(undefined, opts),
});

async function setup(opts: BitburnerPluginOptions, pluginBuild: PluginBuild) {
    const { outdir } = pluginBuild.initialOptions;

    if (!opts.port) {
        throw new Error('No port provided');
    }

    if (pluginBuild.initialOptions.write) {
        throw new Error("BitburnerPlugin doesn't support 'write' mode");
    }

    if (!outdir) {
        throw new Error('BitburnerPlugin requires the outdir option to be set');
    }

    if (typeof opts != 'object') {
        throw new TypeError('Expected options to be an object');
    } //Ensure opts is an object

    if (opts.remoteDebugging) {
        pluginBuild.initialOptions.sourcemap ??= 'inline';
        pluginBuild.initialOptions.sourcesContent ??= false;
        pluginBuild.initialOptions.sourceRoot ??= '/';
    }

    pluginBuild.initialOptions.metafile = true;
    pluginBuild.initialOptions.loader ??= {};
    pluginBuild.initialOptions.loader['.wasm'] = 'binary';

    // const wasmPackages: [string, string][] = [];
    const extensions = parseExtensions(opts.extensions);

    await runExtensions(extensions.setup);

    const remoteAPI = new RemoteApiServer({
        port: opts.port,
    });

    pluginBuild.onDispose(() => {
        remoteAPI.shutdown();
    });

    remoteAPI.addEventListener('client-connected', async () => {
        const nsdef = await remoteAPI.interface!.getDefinitionFile();

        if (nsdef.isError) {
            return;
        }

        Deno.writeTextFile(
            opts.types ?? './NetscriptDefinitions.d.ts',
            nsdef.unwrap().result,
        );
    });

    let queued = false;
    let startTime: number;

    pluginBuild.onStart(() => runExtensions(extensions.beforeBuild));

    pluginBuild.onStart(() => {
        startTime = Date.now();
        Deno.remove(outdir, { recursive: true }).catch(() => {});
    });

    pluginBuild.onResolve(
        { filter: /^react(-dom)?$/ },
        (opts) => ({
            namespace: 'react',
            path: opts.path,
        }),
    );

    pluginBuild.onLoad(
        { filter: /^react(-dom)?$/, namespace: 'react' },
        (opts) => ({
            contents: `module.exports = ${opts.path == 'react' ? 'React' : 'ReactDOM'}`,
        }),
    );

    pluginBuild.onEnd(async (result) => {
        if (result.errors.length != 0) return;
        if (queued) return;

        const endTime = Date.now();

        if (!remoteAPI.interface) {
            queued = true;
            console.log('Build successful, waiting for client to connect');
        }

        const rfaInterface = await remoteAPI.connect();

        if (opts.remoteDebugging) {
            // await fixSourceMappings(pluginBuild.initialOptions.outdir!);
        }

        await runExtensions(extensions.afterBuild, rfaInterface, result.metafile!);

        const filesWithRAM = await upload(outdir, rfaInterface);

        console.log();
        console.log(formatOutputFiles(filesWithRAM).join('\n'));
        console.log();
        console.log(
            `⚡ \x1b[32mDone in \x1b[33m${endTime - startTime}ms\x1b[0m`,
        );
        console.log();
        queued = false;
    });
}

async function runExtensions<T extends Required<PluginExtension>[keyof PluginExtension]>(
    extensions: T[],
    ...args: Parameters<T>
) {
    const errors: unknown[] = [];

    await Promise.all(
        extensions
            //@ts-ignore fuck you
            .map(async (ext) => await ext(...args))
            .map((ext) => ext.catch((e) => errors.push(e))),
    );

    for (const error of errors) {
        const msg = error instanceof Error ? error.stack : String(error);

        const formatted = formatMessagesSync([{ text: msg }], {
            color: true,
            kind: 'error',
        })[0];
        console.log(formatted);
    }
}

async function upload(outdir: string, remoteAPI: RemoteApiInterface, server = 'home') {
    const files = (await Array.fromAsync(walk(outdir, { includeSymlinks: false })))
        .filter((file) => file.isFile)
        .map((file) => ({
            filename: `./${file.path}`.replaceAll('\\', '/').replace(outdir + '/', ''),
            path: `${file.path}`,
        }));

    const errors: string[] = [];

    const failed_files: { filename: string; path: string }[] = [];

    for (const file of files) {
        const result = await remoteAPI.pushFile({
            filename: file.filename,
            server,
            content: await Deno.readTextFile(file.path),
        });

        result.mapError((error) => {
            errors.push(`Can not push "${file.filename}" to "${server}": ${JSON.stringify(error)}`);
            failed_files.push(file);
        });
    }

    const formattedErrors = await formatMessages(errors.map((e) => ({ text: e })), {
        kind: 'error',
        color: true,
    });

    for (const err of formattedErrors) console.error(err);

    return Promise.all(
        files
            .filter((file) => !failed_files.includes(file))
            .map(async ({ filename }) => ({
                filename,
                server,
                cost: (await remoteAPI.calculateRAM({ filename, server }))
                    .map((r) => r.result)
                    .unwrapOr(0),
            })),
    );
}
