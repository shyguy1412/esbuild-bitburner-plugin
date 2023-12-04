export type BitburnerPluginOptions = {
  port: number,
  types?: string,
  mirror?: {
    [path: string]: string[];
  },
  distribute?: {
    [path: string]: string[];
  },
  extensions?: {
    setup?: () => void | Promise<void>;
    beforeConnect?: () => void | Promise<void>;
    afterConnect?: (remoteAPI: import('./RemoteApiServer')) => void | Promise<void>;

    beforeBuild?: () => void | Promise<void>;
    afterBuild?: (remoteAPI: import('./RemoteApiServer')) => void | Promise<void>;

    beforeDistribute?: (remoteAPI: import('./RemoteApiServer')) => void | Promise<void>;
    afterDistribute?: (remoteAPI: import('./RemoteApiServer')) => void | Promise<void>;
  }[];
};
const BitburnerPlugin: (opts: BitburnerPluginOptions) => import('esbuild').Plugin;
export default BitburnerPlugin;
export type PluginExtension = NonNullable<BitburnerPluginOptions['extensions']>[number];
