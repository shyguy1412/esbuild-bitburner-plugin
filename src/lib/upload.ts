import fs from 'fs/promises';
import { createLogBatch } from './log';
import { RemoteApiServer } from './RemoteApiServer';

export async function upload(outdir: string, remoteAPI: RemoteApiServer) {
  const rawFiles = (await fs.readdir(outdir, { recursive: true, withFileTypes: true }))
    .filter((file) => file.isFile())
    .map((file) => ({
      name: file.name,
      path: file.parentPath.replaceAll('\\', '/').replace(/^.*?\//, ''), // rebase path
    }))
    .map((file) => ({
      server: file.path.split('/')[0]!,
      filename: `${file.path}/${file.name}`.replace(/^.*?\//, ''),
      path: `${outdir}/${file.path}/${file.name}`,
    }));

  const logger = createLogBatch();

  const validServers = await rawFiles.reduce(async (prev, { server }) => {
    return prev.then(async (prev) => {
      if (prev[server]) return prev;
      prev[server] = await remoteAPI.getFileNames(server).then((_) => true).catch((
        _,
      ) => false);
      if (!prev[server]) {
        logger.warn(
          `Invalid server '${server}': ignoring files to be pushed to '${server}'`,
        );
      }
      return prev;
    });
  }, Promise.resolve({} as Record<string, boolean>));

  const files = rawFiles.filter((f) => validServers[f.server]);

  const failed_files: { filename: string, server: string; }[] = [];

  await Promise.all(
    files.map(async ({ filename, server, path }) =>
      remoteAPI.pushFile({
        filename,
        server,
        content: (await fs.readFile(path)).toString('utf8'),
      }).catch(({ error }) => {
        logger.error(`Can not push "${filename}" to "${server}": ${error}`);
        failed_files.push({ filename, server });
      }
      )),
  );

  logger.dispatch();

  return Promise.all(
    files
      .filter(file => !failed_files.find(failed_file =>
        (file.filename == failed_file.filename && file.server == failed_file.server)
      ))
      .map(async ({ filename, server }) => ({
        filename,
        server,
        cost: await remoteAPI.calculateRAM({ filename, server })
          .then(response => response.result)
          .catch(() => 0),
      })),
  );
}
