import path from 'path';
import fs from 'fs/promises';
import { existsSync as pathExists } from 'fs';
import { FSWatcher, watch as watchDirectory } from 'chokidar';
import { RemoteApiServer } from './RemoteApiServer';
import { BitburnerPluginOptions } from '.';
import { createLogBatch } from './lib/log';


export class RemoteFileMirror {
  static remoteApi: RemoteApiServer;

  servers: string[];
  targetPath: string;
  fileCache: Record<string, string> = {};
  syncing = false;
  remotePollTimeout: NodeJS.Timeout | undefined;
  fileWatcher: FSWatcher | undefined;
  options: BitburnerPluginOptions;

  constructor(targetPath: string, servers: string[], options: BitburnerPluginOptions) {
    if (!RemoteFileMirror.remoteApi) {
      throw new Error('Assign remoteAPI before instantiating');
    }

    this.targetPath = targetPath;
    this.servers = servers;
    this.options = options;

    console.log(`Creating mirror [${servers.join(', ')}] => ${targetPath}`);
  }

  async initFileCache() {
    console.log(`Initialising file cache for [${this.servers.join(', ')}]`);
    const files = (await fs.readdir(this.targetPath, { recursive: true, withFileTypes: true })).filter(f => f.isFile());

    for (const file of files) {
      const filePath = path.join(file.path, file.name).replaceAll('\\', '/');
      const content = (await fs.readFile(filePath)).toString('utf8');
      const remoteUrl = filePath.replace(this.targetPath, '').replace(/\/?(.*?)\//, '$1://');
      this.fileCache[remoteUrl] = content;
    }
  }

  writeToFilesCache(files: Record<string, string>) {
    for (const file in files) {
      this.fileCache[file] = files[file];
    }
  };

  compareFilesToCache(files: Record<string, string>) {
    const diff = {
      mod: {} as Record<string, string>,
      rem: {} as Record<string, string>,
    };

    for (const file in files) {
      if (files[file] != this.fileCache[file]) {
        diff.mod[file] = files[file];
      }
    }

    for (const file in this.fileCache) {
      if (files[file] == undefined) {
        diff.rem[file] = this.fileCache[file];
      }
    }

    return diff;
  };

  async compareCacheToRemote() {
    const files = await this.getAllServerFiles();
    return this.compareFilesToCache(files);
  }

  async getAllServerFiles() {
    const files: Record<string, string> = {};

    for (const server of this.servers) {
      const serverFiles = (await RemoteFileMirror.remoteApi.getAllFiles(server)).result;

      if (!serverFiles) continue;

      for (const { filename, content } of serverFiles) {
        files[`${server}://${filename}`] = content;
      }

    }
    return files;
  }

  async syncWithRemote() {
    if (this.syncing) return;
    this.syncing = true;
    const files = await this.getAllServerFiles();

    const { mod: filesToWrite, rem: filesToRemove } = this.compareFilesToCache(files);

    this.writeToFilesCache(files);

    const diff = { ...filesToWrite, ...filesToRemove }; //For output formatting only

    if (Object.keys(diff).length != 0)
      console.log(`Remote change detected, syncing files with [${Object
        .keys(diff)
        .map(k => k.split('://', 2)[0])
        .filter((el, i, arr) => i == arr.indexOf(el))
        .join(', ')}]`
      );

    // if (Object.keys(filesToRemove).length > 0 || Object.keys(filesToWrite).length > 0) {
    //   this.logger.log({
    //     filesToWrite,
    //     filesToRemove,
    //   }, Object.keys(diff).length);
    // }

    const logger = createLogBatch();
    for (const file in filesToWrite) {
      const content = filesToWrite[file];
      const filePath = path.join(this.targetPath, file.replace(/:\/\//, '/'));

      if (!pathExists(path.dirname(filePath)))
        await fs.mkdir(path.dirname(filePath), { recursive: true });

      await fs.writeFile(filePath, content);
      logger.log(`Wrote file ${file} to ${filePath}`);
    }

    logger.dispatch();

    for (const file in filesToRemove) {
      delete this.fileCache[file];

      const filePath = path.join(this.targetPath, file.replace(/:\/\//, '/'));

      if (!pathExists(filePath))
        continue;

      await fs.rm(filePath);

      if ((await fs.readdir(path.dirname(filePath))).length == 0) {
        await fs.rmdir(path.dirname(filePath));
      }

      logger.log(`Deleted file ${file}`);
    }

    if (Object.keys(filesToRemove).length > 0 || Object.keys(filesToWrite).length > 0) {
      logger.log();
    }

    logger.dispatch();

    this.syncing = false;
  }

  watch() {
    if (this.remotePollTimeout)
      return;

    const pollRemote = () => {
      this.syncWithRemote();
      this.remotePollTimeout = setTimeout(pollRemote, 500);
    };

    pollRemote();

    this.fileWatcher = watchDirectory(this.targetPath, { ignoreInitial: true, usePolling: this.options.usePolling, interval: this.options.pollingInterval });

    this.fileWatcher.on('all', async (e, filePath) => {
      if (this.syncing) return;

      const deleted = !pathExists(filePath);
      if ((!deleted && !(await fs.stat(filePath)).isFile()) || e == 'add')
        return;

      const sanitizedFilePath = filePath.replaceAll('\\', '/');

      const remoteServer = sanitizedFilePath.replace(this.targetPath, '').replace(/\/?(.*?)\/.*/, '$1');
      const remotePath = sanitizedFilePath.replace(this.targetPath, '').replace(`/${remoteServer}/`, '');

      const file = await RemoteFileMirror.remoteApi.getFile({
        filename: remotePath,
        server: remoteServer
      }).catch(_ => undefined);

      if (deleted && !file) return; //File is already deleted
      if (!deleted && file?.result == (await fs.readFile(sanitizedFilePath)).toString('utf8')) return; //file hasnt changed
      
      console.log(`Local change detected, syncing files with [${remoteServer}]`);

      const logger = createLogBatch();
      if (deleted) {
        await RemoteFileMirror.remoteApi.deleteFile({
          filename: remotePath,
          server: remoteServer
        });

        if ((await fs.readdir(path.dirname(sanitizedFilePath))).length == 0) {
          await fs.rmdir(path.dirname(sanitizedFilePath));
        }

        logger.log(`Deleted file ${remoteServer}://${remotePath}`);

      } else {

        const content = (await fs.readFile(sanitizedFilePath)).toString('utf8');

        await RemoteFileMirror.remoteApi.pushFile({
          filename: remotePath,
          server: remoteServer,
          content
        });

        this.writeToFilesCache({ [`${remoteServer}://${remotePath}`]: content });
        logger.log(`Wrote file ${sanitizedFilePath} to ${remoteServer}://${remotePath}`);
      }

      logger.log().dispatch();
    });

  }

  dispose() {
    if (this.remotePollTimeout)
      clearTimeout(this.remotePollTimeout);
    if (this.fileWatcher)
      this.fileWatcher.close();

  }

}

