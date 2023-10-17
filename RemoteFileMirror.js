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
    
    this.targetPath = targetPath;
    this.servers = servers;
  
  }

  writeToFilesCache(files) {
    for(const file in files){
      fileCache[file] = files[file]
    }
  };

  compareFilesToCache (files) {
    const diff = {}
    for(const file of files){
      if(files[file].content != fileCache[file].content){
        diff[file] = files[file];
      }
    }
  };

  async getAllServerFiles() {
    const files = [];
    for (const server of this.servers){
      const serverFiles = (await this.getAllFiles(server)).result;
      if(!serverFiles)continue;
      files.push(...serverFiles.map(file => ({
        filename: file.filename,
        server,
        content: file.content
      })));
    }
    return files;
  }
 
  async syncWithRemote(){
    syncing = true;
    console.log('getting files')
    const files = await getAllServerFiles();

    const diff = compareFilesToCache(files);

    writeToFilesCache(files);

    for(const file of diff){
      const filePath = path.join(targetPath, file.server, file.filename);
          
      if(!pathExists(path.dirname(filePath)))
        await fs.mkdir(path.dirname(filePath), {recursive: true});

      await fs.writeFile(filePath, file.content);
    }
    syncing = false;
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


