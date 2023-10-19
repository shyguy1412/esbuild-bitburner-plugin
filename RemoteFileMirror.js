const path = require('path');
const fs = require('fs/promises');
const {log} = require('console');
const pathExists = require('fs').existsSync;
const watchDirectory = require('chokidar').watch;


class RemoteFileMirror{
  static remoteApi;

  servers = [];
  targetPath;
  fileCache = {};
  syncing = false;
  remotePollTimeout;
  fileWatcher;

  constructor(targetPath, servers){
    if(!RemoteFileMirror.remoteApi){
      throw new Error('Assign remoteAPI before instantiating');
    }
    
    console.log(`Creating mirror [${servers.join(', ')}] => ${targetPath}`);
    
    this.targetPath = targetPath;
    this.servers = servers;

  }

  async initFileCache(){
    console.log(`Initialising file cache for [${this.servers.join(', ')}]`);
    const files = (await fs.readdir(this.targetPath, {recursive: true, withFileTypes:true})).filter(f => f.isFile());
   
    for(const file of files){
      const filePath = path.join(file.path, file.name); 
      const content = (await fs.readFile(filePath)).toString('utf8');
      const remoteUrl = filePath.replace(this.targetPath, '').replace(/\/?(.*?)\//, '$1://');
      this.fileCache[remoteUrl] = content;
    }
  }

  writeToFilesCache(files) {
    for(const file in files){
      this.fileCache[file] = files[file];
    }
  };

  compareFilesToCache (files) {
    const diff = {
      mod: {},
      rem: {},
    }
    
    for(const file in files){
      if(files[file] != this.fileCache[file]){
        diff.mod[file] = files[file];
      }
    }

    for(const file in this.fileCache){
      if(!files[file]){
        diff.rem[file] = this.fileCache[file]
      }
    }

    return diff;
  };

  async compareCacheToRemote(){
    const files = await this.getAllServerFiles();
    return this.compareFilesToCache(files);
  }

  async getAllServerFiles() {
    const files = {};

    for (const server of this.servers){
      const serverFiles = (await RemoteFileMirror.remoteApi.getAllFiles(server)).result;
      
      if(!serverFiles)continue;
      
      for(const {filename, content} of serverFiles){
        files[`${server}://${filename}`] = content;
      }
    
    }
    return files;
  }
 
  async syncWithRemote(){
    if(this.syncing)return;
    this.syncing = true;
    const files = await this.getAllServerFiles();

    const {mod:filesToWrite, rem:filesToRemove} = this.compareFilesToCache(files);

    this.writeToFilesCache(files);
    
    const diff = {...filesToWrite, ...filesToRemove}; //For output formatting only

    if(Object.keys(diff).length != 0)
      console.log(`Change detected, syncing files with [${Object
        .keys(diff)
        .map(k => k.split('://', 2)[0])
        .filter((el, i, arr) => i == arr.indexOf(el))
        .join(', ')}]`
      );

    for(const file in filesToWrite){
      const content = filesToWrite[file];
      const filePath = path.join(this.targetPath, file.replace(/:\/\//, '/'));
          
      if(!pathExists(path.dirname(filePath)))
        await fs.mkdir(path.dirname(filePath), {recursive: true});

      await fs.writeFile(filePath, content);
      console.log(`Wrote file ${file} to ${filePath}`);
    }

    for(const file in filesToRemove){
      const filePath = path.join(this.targetPath, file.replace(/:\/\//, '/'));
          
      if(!pathExists(filePath))
        continue;

      await fs.rm(filePath);
      delete this.fileCache[file];

      if((await fs.readdir(path.dirname(filePath))).length == 0){
        await fs.rm(path.dirname(filePath));
      }

      console.log(`Deleted file ${file}`);
    }
    this.syncing = false;
  }

  watch(){
    if(this.remotePollTimeout)
      return;

    const pollRemote = () => {
      this.syncWithRemote();
      this.remotePollTimeout = setTimeout(pollRemote, 500);
    }

    pollRemote();

    this.fileWatcher = watchDirectory(this.targetPath, {ignoreInitial: true});

    this.fileWatcher.on('all', async (e, filePath) => {
      const deleted = !pathExists(filePath);
      if(!deleted && !(await fs.stat(filePath)).isFile())
        return;


      const remotePath = filePath.replace(this.targetPath, '').replace(/\/?.*?\/?/, '');
      const remoteServer = filePath.replace(this.targetPath, '').replace(/\/?(.*?)\/.*/, '$1');
      
      console.log(`Change detected, syncing files with [${remoteServer}], ${deleted}`);
      if(deleted){
        await RemoteFileMirror.remoteApi.deleteFile({
          filename: remotePath,
          server: remoteServer
        });

        console.log(`Delete file ${remoteServer}://${remotePath}`)
      
      } else {

        const content = await fs.readFile(filePath);
        
        await RemoteFileMirror.remoteApi.pushFile({
          filename: remotePath,
          server: remoteServer,
          content
        });

        console.log(`Wrote file ${filePath} to ${remoteServer}://${remotePath}`);
      }
    });

  }

  dispose(){
    if(this.remotePollTimeout)
      clearTimeout(this.remotePollTimeout);
    if(this.fileWatcher)
      this.fileWatcher.close();

  }

}

/*
    let syncing = false;

    
    const watch = () => {

    };

    const dispose = () => {

    }

    const fileCache = {};



    return {
      ,
      watch,
      dispose
    }
  }*/

module.exports = RemoteFileMirror;

