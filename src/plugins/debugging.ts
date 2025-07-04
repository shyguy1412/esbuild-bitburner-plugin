import fs from 'fs/promises';

export async function fixSourceMappings(outdir: string) {
  const outputFiles = await fs.readdir(outdir, {
    recursive: true,
    withFileTypes: true,
  })
    .then((f) => f.filter((f) => f.isFile()));

  const relativeSourceMapToAbsolute = (content: string) => {
    if (!content) return content;
    if (!content.includes('//# sourceMappingURL=')) {
      return content;
    }

    // We assume the sourcemap comment is the last line of the file, which it should always be.
    const [pretext, sourcemapText] = content.split(
      '//# sourceMappingURL=data:application/json;base64,',
    );
    if (!sourcemapText) return content;

    const sourcemap = JSON.parse(
      Buffer.from(sourcemapText, 'base64').toString(),
    ) as { sources: string[] };

    sourcemap.sources = sourcemap.sources.map((source) => {
      // remap sources from `../../../servers/...` to be `servers/...` instead,
      // so VSCode can properly map ingame files' sourcemaps to our scripts.
      return source.startsWith('.') ? source.replace(/(\.\.\/)*/, './') : source;
    });

    const newText = `${pretext}\n//# sourceMappingURL=data:application/json;base64,${
      Buffer.from(JSON.stringify(sourcemap)).toString('base64')
    }`;

    return newText;
  };

  await Promise.all(
    outputFiles.map(async (file) =>
      fs.writeFile(
        `${file.parentPath}/${file.name}`,
        relativeSourceMapToAbsolute(
          await fs.readFile(`${file.parentPath}/${file.name}`, { encoding: 'utf8' }),
        ),
      )
    ),
  ).catch((_) => console.log(_));
}
