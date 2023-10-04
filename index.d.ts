export type BitburnerPluginOptions = {
  servers?: string[] | 'auto',
  port?: number,
}
const BitburnerPlugin: (opts:BitburnerPluginOptions) => import('esbuild').Plugin
export default BitburnerPlugin;
