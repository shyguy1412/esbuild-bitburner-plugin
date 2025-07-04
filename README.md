# esbuild-bitburner-plugin

This is an ESBuild plugin that uses Bitburners remote API to push the build results into
the game.

If you are looking for a ready to go template for your workspace, have a look at
[bb-external-editor](https://github.com/shyguy1412/bb-external-editor).

## How to use

```js
const createContext = async () =>
  await context({
    entryPoints: [
      'servers/**/*.js',
      'servers/**/*.jsx',
      'servers/**/*.ts',
      'servers/**/*.tsx',
    ],
    outbase: './servers',
    outdir: './build',
    plugins: [BitburnerPlugin({
      port: 12525,
      types: 'NetscriptDefinitions.d.ts',
    })],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'info',
  });

let ctx = await createContext();
ctx.watch();
```

## Using React

This plugin allows you to use the ingame instances of `React` and `ReactDOM` simply by
importing them as ESModule as you usually would.

```jsx
import React, {useState} from 'react';

export function MyComponent(){
  const [count, setCount] = useState(0);

  return <div>Count {count} <button onClick={() => setCount(count + 1)}>Add to count</button></div>;
}
```

## Uploading into the game

The output folder structure determines to which ingame server each file is sent to. So if
the transpilation results in the following structure:

```txt
build
  ├──home
  │   └───homeScript.js
  └──otherServer
      └───otherScript.js
```

then `homeScript.js` will be uploaded to `home` and `otherScript.js` to `otherServer`.

## Options

### Port

The port that the RemoteAPI Server will listen on. This is the same port that you need to
enter inside Bitburner to connect to your editor.

### Types

This is the path that the Netscript Definitions file will be placed at. This is optional.

### Polling

If your filesystem does not support filesystem events, you can set `usePolling` to true to
enable polling.\
You can also set `pollingInterval` to set the polling interval in ms

### Push on Connect

This option only affects mirror behaviour.\
By default the game synchronizes the mirror with the ingame state on (re)connect. This
means all changes made while not connected will be lost. By setting `pushOnConnect` to
true, the mirror will always be uploaded into the game first, preserving any changes made
when not connected.

### Mirror

This enables file mirroring. You can use this to map remote servers to a local path like
this:

```js
const createContext = async () =>
  await context({
    entryPoints: [
      'servers/**/*.js',
      'servers/**/*.jsx',
      'servers/**/*.ts',
      'servers/**/*.tsx',
    ],
    outbase: './servers',
    outdir: './build',
    plugins: [BitburnerPlugin({
      port: 12525,
      types: 'NetscriptDefinitions.d.ts',
      mirror: {
        'local/path': ['home', 'and/or other servers'],
      },
    })],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'info',
  });

let ctx = await createContext();
ctx.watch();
```

Any file on home would then be placed in `local/path/home` and other servers in their
respective directories. Any changes made locally will then be synced into the game and any
changes made in the game will also be synced locally.

### Distribute

This enables automatic distribution of files in a folder to multiple servers. For example,
you can select a folder in 'build' to distribute scripts automatically once built like
this

```js
const createContext = async () =>
  await context({
    entryPoints: [
      'servers/**/*.js',
      'servers/**/*.jsx',
      'servers/**/*.ts',
      'servers/**/*.tsx',
    ],
    outbase: './servers',
    outdir: './build',
    plugins: [BitburnerPlugin({
      port: 12525,
      types: 'NetscriptDefinitions.d.ts',
      distribute: {
        'build/home/dist': ['server-1', 'server-2', 'server-3'],
      },
    })],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'info',
  });

let ctx = await createContext();
ctx.watch();
```

now all files that are developed in 'servers/home/dist' will not only be uploaded to
'home' but also 'server-1', 'server-2' and 'server-3'.

### Plugin Extensions

You can provide plugin extensions with hooks that trigger before and after certain events.
Within hooks that gurantee that the plugin is connected to the game, you also get full
access to the remote file API. Using extensions would look something like this:

```js
import { context } from 'esbuild';
import { BitburnerPlugin } from 'esbuild-bitburner-plugin';

/** @type import('esbuild-bitburner-plugin').PluginExtension*/
const customExtension = {
  setup() {
    console.log('setup');
  }, //Run once on plugin startup

  beforeConnect() {
    console.log('beforeConnect');
  }, //Run once before the game connects
  afterConnect(remoteAPI) {
    console.log('afterConnect');
  }, //Run every time after the game (re)connects

  beforeBuild() {
    console.log('beforeBuild');
  }, //Run before every build process
  afterBuild(remoteAPI) {
    console.log('afterBuild');
  }, //Run after build, before results are uploaded into the game
};

const createContext = async () =>
  await context({
    entryPoints: [
      'servers/**/*.js',
      'servers/**/*.jsx',
      'servers/**/*.ts',
      'servers/**/*.tsx',
    ],
    outbase: './servers',
    outdir: './build',
    plugins: [
      BitburnerPlugin({
        port: 12525,
        types: 'NetscriptDefinitions.d.ts',
        extensions: [customExtension],
      }),
    ],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'info',
  });

const ctx = await createContext();
ctx.watch();
```

## Remote Debugging

This tool supports remote debugging for both the Steam version and the web version running
in a Chrome/Chromium browser.

### Setup

1. Enable remote debugging

```js
const createContext = async () =>
  await context({
    entryPoints: [
      'servers/**/*.js',
      'servers/**/*.jsx',
      'servers/**/*.ts',
      'servers/**/*.tsx',
    ],
    outbase: './servers',
    outdir: './build',
    plugins: [
      BitburnerPlugin({
        port: 12525,
        types: 'NetscriptDefinitions.d.ts',
        remoteDebugging: true,
      }),
    ],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    logLevel: 'info',
  });

const ctx = await createContext();
ctx.watch();
```

1. (for VSCode) add `.vscode/launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "attach",
      "name": "Attach to BitBurner (Steam)",
      "port": 9222
    },
    {
      "type": "chrome",
      "request": "attach",
      "name": "Attach to BitBurner (Web)",
      "port": 9222,
      "urlFilter": "https://bitburner-official.github.io/*",
      "webRoot": "${workspaceFolder}"
    }
  ]
}
```

### Steam

To enable remote debugging for the Steam version go into the properties for Bitburner
(little cogwheel to the right when viewing Bitburner in your library) and add the
following launch option `--remote-debugging-port=9222`.

### Chrome/Chromium

To enable remote debugging for your browser you need to launch it over the commandline
like so:

```sh
<path-to-chrome> --remote-debugging-port=9222
```
