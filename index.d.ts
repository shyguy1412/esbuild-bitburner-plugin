export type BitburnerPluginOptions = {
  port: number,
  types?: string,
  mirror: {
    [path:string]: string[]
  },
  distribute: {
    [path:string]: string[]
  }
}
const BitburnerPlugin: (opts:BitburnerPluginOptions) => import('esbuild').Plugin
export default BitburnerPlugin;
export let remoteAPI: import('./RemoteApiServer');

