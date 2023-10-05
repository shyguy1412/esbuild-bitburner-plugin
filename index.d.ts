export type BitburnerPluginOptions = {
  servers?: string[],
  port?: number,
}
const BitburnerPlugin: (opts:BitburnerPluginOptions) => import('esbuild').Plugin
export default BitburnerPlugin;
