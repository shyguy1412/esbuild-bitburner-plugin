# esbuild-bitburner-plugin

This is an ESBuild plugin that uses Bitburners remote API to push the build results into the game.

If you are looking for a ready to go template for your workspace, have a look at [bb-external-editor](https://github.com/NilsRamstoeck/bb-external-editor).

## How to use

Here is an example using [glob](https://www.npmjs.com/package/glob) to capture all entrypoints:

```js
const createContext = async () => await context({
  entryPoints: await glob('./servers/**/*.{js,jsx,ts,tsx}'),
  outbase: "./servers",
  outdir: "./dist",
  plugins: [BitburnerPlugin({
    port: 12525,
    types: 'NetscriptDefinitions.d.ts'
  })],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  logLevel: 'info'
});

let ctx = await createContext();
ctx.watch();
```

## Using React

This plugin allows you to use the ingame instances of `React` and `ReactDOM` simply by importing them as ESModule as you usually would.

```jsx
import React, {useState} from 'react';

export MyComponent(){
  const [count, setCount] = useState(0);

  return <div>Count {count} <button onClick={() => setCount(count + 1)}>Add to count</button></div>;
}

```

## Uploading into the game

The output folder structure determines to which ingame server each file is sent to.
So if the transpilation results in the following structure:

```txt
dist
  ├──home
  │   └───homeScript.js
  └──otherServer
      └───otherScript.js
```

then `homeScript.js` will be uploaded to `home` and `otherScript.js` to `otherServer`.

This Plugin has 2 options:

port: The port that the RemoteAPI Server will listen on. This is the same port that you need to enter inside Bitburner to connect to the Plugin. default is `12525`.

types: This is the path that the Netscript Definitions file will be placed at. This is optional.
