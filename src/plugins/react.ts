import { PluginBuild } from 'esbuild';

export function reactPlugin(pluginBuild: PluginBuild) {
  pluginBuild.onResolve({ filter: /^react(-dom)?$/ }, (opts) => {
    return {
      namespace: 'react',
      path: opts.path,
    };
  });

  pluginBuild.onLoad(
    { filter: /^react(-dom)?$/, namespace: 'react' },
    (opts) => {
      if (opts.path == 'react') {
        return {
          contents: 'module.exports = React',
        };
      } else if (opts.path == 'react-dom') {
        return {
          contents: 'module.exports = ReactDOM',
        };
      }
    },
  );
}
