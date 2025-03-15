import { formatMessages, PluginBuild } from 'esbuild';

export async function loggingPlugin(pluginBuild: PluginBuild) {
  pluginBuild.onEnd(async (result) => {
    if (!result.errors.length && !result.warnings.length) return;
    if (['silent', 'verbose', 'debug'].includes(pluginBuild.initialOptions.logLevel!)) {
      return;
    }

    const warnings = await formatMessages(result.warnings, {
      kind: 'warning',
      color: true,
    });
    const errors = await formatMessages(result.errors, {
      kind: 'error',
      color: true,
    });

    while (warnings.length && pluginBuild.initialOptions.logLevel != 'error') {
      console.log(warnings.shift()?.trimEnd());
      console.log();
    }

    while (errors.length) {
      console.log(errors.shift()?.trimEnd());
      console.log();
    }
  });
}
