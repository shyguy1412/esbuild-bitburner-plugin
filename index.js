
/** @type {(opts:any) => import('esbuild').Plugin} */
const BitburnerPlugin = (opts) => ({
  name: "BitburnerPlugin",
  setup(pluginBuild){
    if(!pluginBuild.initialOptions.write)
      throw new Error("BitburnerPlugin only supports 'write' mode");
    pluginBuild.onEnd((result) => {
      console.log(result);
    })
  }
});
