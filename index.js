
/** @type {(opts:any) => import('esbuild').Plugin} */
const BitburnerPlugin = (opts) => ({
  name: "BitburnerPlugin",
  setup(pluginBuild){
    pluginBuild.initialOptions.metafile = true;
    if(pluginBuild.initialOptions.write)
      throw new Error("BitburnerPlugin doesn't support 'write' mode");
    pluginBuild.onEnd((result) => {
      console.log(result);
    })
  }
});

module.exports = {
  default: BitburnerPlugin,
  BitburnerPlugin
}
