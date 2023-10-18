const path = require('path');
const fs = require('fs/promises');
const {log} = require('console');
const pathExists = require('fs').existsSync;

class RemoteFileMirror{
  static remoteApi;

  servers = [];
  targetPath;
  fileCache = {};
  syncing = false;

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
    const diff = {}
    for(const file in files){
      if(files[file] != this.fileCache[file]){
        diff[file] = files[file];
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

    const diff = this.compareFilesToCache(files);

    this.writeToFilesCache(files);
   
    if(Object.keys(diff).length != 0)
      console.log(`Syncing files with [${Object
        .keys(diff)
        .map(k => k.split('://', 2)[0])
        .filter((el, i, arr) => i == arr.indexOf(el))
        .join(', ')}]`
      );

    for(const file in diff){
      const content = diff[file];
      const filePath = path.join(this.targetPath, file.replace(/:\/\//, '/'));
          
      if(!pathExists(path.dirname(filePath)))
        await fs.mkdir(path.dirname(filePath), {recursive: true});

      await fs.writeFile(filePath, content);
      console.log(`Wrote file ${file} to ${filePath}`);
    }
    this.syncing = false;
  }

  watch(){}

  dispose(){}

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

