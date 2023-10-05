export type BitburnerPluginOptions = {
  port: number,
  types?: string
}
const BitburnerPlugin: (opts:BitburnerPluginOptions) => import('esbuild').Plugin
export default BitburnerPlugin;
