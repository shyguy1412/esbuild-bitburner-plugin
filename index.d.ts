export type BitburnerPluginOptions = {
  port: number,
  types?: string,
  mirror: {
    [path:string]: string[]
  }
}
const BitburnerPlugin: (opts:BitburnerPluginOptions) => import('esbuild').Plugin
export default BitburnerPlugin;
