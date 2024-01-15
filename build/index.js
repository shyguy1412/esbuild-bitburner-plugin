"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  BitburnerPlugin: () => BitburnerPlugin
});
module.exports = __toCommonJS(src_exports);

// src/RemoteApiServer.ts
var import_http = __toESM(require("http"));

// src/RemoteFileMirror.ts
var import_path = __toESM(require("path"));
var import_promises = __toESM(require("fs/promises"));
var import_fs = require("fs");
var import_chokidar = require("chokidar");
var RemoteFileMirror = class _RemoteFileMirror {
  constructor(targetPath, servers) {
    this.fileCache = {};
    this.syncing = false;
    if (!_RemoteFileMirror.remoteApi) {
      throw new Error("Assign remoteAPI before instantiating");
    }
    console.log(`Creating mirror [${servers.join(", ")}] => ${targetPath}`);
    this.targetPath = targetPath;
    this.servers = servers;
  }
  async initFileCache() {
    console.log(`Initialising file cache for [${this.servers.join(", ")}]`);
    const files = (await import_promises.default.readdir(this.targetPath, { recursive: true, withFileTypes: true })).filter((f) => f.isFile());
    for (const file of files) {
      const filePath = import_path.default.join(file.path, file.name).replaceAll("\\", "/");
      const content = (await import_promises.default.readFile(filePath)).toString("utf8");
      const remoteUrl = filePath.replace(this.targetPath, "").replace(/\/?(.*?)\//, "$1://");
      this.fileCache[remoteUrl] = content;
    }
  }
  writeToFilesCache(files) {
    for (const file in files) {
      this.fileCache[file] = files[file];
    }
  }
  compareFilesToCache(files) {
    const diff = {
      mod: {},
      rem: {}
    };
    for (const file in files) {
      if (files[file] != this.fileCache[file]) {
        diff.mod[file] = files[file];
      }
    }
    for (const file in this.fileCache) {
      if (files[file] == void 0) {
        diff.rem[file] = this.fileCache[file];
      }
    }
    return diff;
  }
  async compareCacheToRemote() {
    const files = await this.getAllServerFiles();
    return this.compareFilesToCache(files);
  }
  async getAllServerFiles() {
    const files = {};
    for (const server of this.servers) {
      const serverFiles = (await _RemoteFileMirror.remoteApi.getAllFiles(server)).result;
      if (!serverFiles)
        continue;
      for (const { filename, content } of serverFiles) {
        files[`${server}://${filename}`] = content;
      }
    }
    return files;
  }
  async syncWithRemote() {
    if (this.syncing)
      return;
    this.syncing = true;
    const files = await this.getAllServerFiles();
    const { mod: filesToWrite, rem: filesToRemove } = this.compareFilesToCache(files);
    this.writeToFilesCache(files);
    const diff = { ...filesToWrite, ...filesToRemove };
    if (Object.keys(diff).length != 0)
      console.log(
        `Remote change detected, syncing files with [${Object.keys(diff).map((k) => k.split("://", 2)[0]).filter((el, i, arr) => i == arr.indexOf(el)).join(", ")}]`
      );
    for (const file in filesToWrite) {
      const content = filesToWrite[file];
      const filePath = import_path.default.join(this.targetPath, file.replace(/:\/\//, "/"));
      if (!(0, import_fs.existsSync)(import_path.default.dirname(filePath)))
        await import_promises.default.mkdir(import_path.default.dirname(filePath), { recursive: true });
      await import_promises.default.writeFile(filePath, content);
      console.log(`Wrote file ${file} to ${filePath}`);
    }
    for (const file in filesToRemove) {
      delete this.fileCache[file];
      const filePath = import_path.default.join(this.targetPath, file.replace(/:\/\//, "/"));
      if (!(0, import_fs.existsSync)(filePath))
        continue;
      await import_promises.default.rm(filePath);
      if ((await import_promises.default.readdir(import_path.default.dirname(filePath))).length == 0) {
        await import_promises.default.rmdir(import_path.default.dirname(filePath));
      }
      console.log(`Deleted file ${file}`);
    }
    if (Object.keys(filesToRemove).length > 0 || Object.keys(filesToWrite).length > 0) {
      console.log();
    }
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
    this.fileWatcher = (0, import_chokidar.watch)(this.targetPath, { ignoreInitial: true });
    this.fileWatcher.on("all", async (e, filePath) => {
      if (this.syncing)
        return;
      const deleted = !(0, import_fs.existsSync)(filePath);
      if (!deleted && !(await import_promises.default.stat(filePath)).isFile() || e == "add")
        return;
      filePath = filePath.replaceAll("\\", "/");
      const remoteServer = filePath.replace(this.targetPath, "").replace(/\/?(.*?)\/.*/, "$1");
      const remotePath = filePath.replace(this.targetPath, "").replace(`/${remoteServer}/`, "");
      const file = await _RemoteFileMirror.remoteApi.getFile({
        filename: remotePath,
        server: remoteServer
      });
      if (deleted && file.error)
        return;
      console.log(`Local change detected, syncing files with [${remoteServer}]`);
      if (deleted) {
        await _RemoteFileMirror.remoteApi.deleteFile({
          filename: remotePath,
          server: remoteServer
        });
        if ((await import_promises.default.readdir(import_path.default.dirname(filePath))).length == 0) {
          await import_promises.default.rmdir(import_path.default.dirname(filePath));
        }
        console.log(`Deleted file ${remoteServer}://${remotePath}`);
      } else {
        const content = (await import_promises.default.readFile(filePath)).toString("utf8");
        await _RemoteFileMirror.remoteApi.pushFile({
          filename: remotePath,
          server: remoteServer,
          content
        });
        this.writeToFilesCache({ [`${remoteServer}://${remotePath}`]: content });
        console.log(`Wrote file ${filePath} to ${remoteServer}://${remotePath}`);
      }
      console.log();
    });
  }
  dispose() {
    if (this.remotePollTimeout)
      clearTimeout(this.remotePollTimeout);
    if (this.fileWatcher)
      this.fileWatcher.close();
  }
};

// src/RemoteApiServer.ts
var import_promises2 = __toESM(require("fs/promises"));
var import_chokidar2 = require("chokidar");
var import_websocket = require("websocket");
var RemoteApiServer = class extends import_websocket.server {
  #counter;
  #queue;
  constructor(options) {
    super({
      httpServer: import_http.default.createServer((request, response) => {
        response.writeHead(404);
        response.end();
      }),
      autoAcceptConnections: false,
      maxReceivedMessageSize: 149e5,
      maxReceivedFrameSize: 149e5
    });
    this.#queue = /* @__PURE__ */ new Map();
    this.#counter = 1;
    this.options = options;
    RemoteFileMirror.remoteApi = this;
  }
  on(event, cb) {
    super.on(event, cb);
    return this;
  }
  createMessageId() {
    return ++this.#counter;
  }
  listen(port, callback) {
    if (!this.config)
      throw new Error("Websocket not initilized");
    const httpServer = this.config.httpServer[0];
    if (httpServer.listening) {
      console.log("WARNING: RemoteAPI Server is already listening on port " + httpServer.address().port);
      return;
    }
    httpServer.listen(port, callback);
    this.on("request", async (request) => {
      if (this.connection && this.connection.connected) {
        request.reject(400, "Only one client can connect at a time");
        return;
      }
      this.connection = request.accept(null, request.origin);
      this.connection.on("message", (e) => {
        const response = JSON.parse(e.type == "utf8" ? e.utf8Data : "");
        if (this.#queue.has(response.id)) {
          this.#queue.get(response.id)(response);
          this.#queue.delete(response.id);
        }
      });
      this.emit("client-connected");
    });
  }
  mirror(targetPath, ...servers) {
    return new RemoteFileMirror(targetPath, servers);
  }
  distribute(targetPath, ...servers) {
    const distributor = (0, import_chokidar2.watch)(targetPath, { ignoreInitial: true, usePolling: this.options.usePolling });
    distributor.on("all", async (e, filePath) => {
      if (e != "add" && e != "change" || !(await import_promises2.default.stat(filePath)).isFile())
        return;
      filePath = filePath.replaceAll("\\", "/");
      const content = (await import_promises2.default.readFile(filePath)).toString("utf8");
      for (const server of servers) {
        await this.pushFile({
          filename: filePath.replace(targetPath, ""),
          //strip basepath
          server,
          content
        });
      }
    });
    return () => {
      distributor.close();
    };
  }
  write(obj) {
    return new Promise((resolve, reject) => {
      if (!this.connection || !this.connection.connected) {
        reject("No open connection");
        return;
      }
      const id = this.createMessageId();
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...obj
      });
      this.#queue.set(id, resolve);
      this.connection.send(message);
      setTimeout(() => reject("message timed out"), 1e4);
    });
  }
  getDefinitionFile() {
    return this.write({
      method: "getDefinitionFile"
    });
  }
  pushFile({ filename, content, server }) {
    return this.write({
      method: "pushFile",
      params: {
        filename,
        content,
        server
      }
    });
  }
  getFile({ filename, server }) {
    return this.write({
      method: "getFile",
      params: {
        filename,
        server
      }
    });
  }
  getFileNames(server) {
    return this.write({
      method: "getFileNames",
      params: {
        server
      }
    });
  }
  getAllFiles(server) {
    return this.write({
      method: "getAllFiles",
      params: {
        server
      }
    });
  }
  deleteFile({ filename, server }) {
    return this.write({
      method: "deleteFile",
      params: {
        filename,
        server
      }
    });
  }
  calculateRAM({ filename, server }) {
    return this.write({
      method: "calculateRam",
      params: {
        filename,
        server
      }
    });
  }
  getAllServers() {
    return this.write({
      method: "getAllServers"
    });
  }
};

// src/index.ts
var import_promises3 = __toESM(require("fs/promises"));
var import_fs2 = require("fs");
var remoteAPI;
var BitburnerPlugin = (opts) => ({
  name: "BitburnerPlugin",
  async setup(pluginBuild) {
    opts ??= {};
    const { outdir } = pluginBuild.initialOptions;
    const extensions = opts.extensions ?? [];
    await Promise.allSettled(extensions.map((e) => (e.setup ?? (() => {
    }))()));
    if (!opts.port)
      throw new Error("No port provided");
    if (pluginBuild.initialOptions.write)
      throw new Error("BitburnerPlugin doesn't support 'write' mode");
    if (!outdir)
      throw new Error("BitburnerPlugin requires the outdir option to be set");
    if (!remoteAPI)
      remoteAPI = new RemoteApiServer(opts);
    remoteAPI.listen(opts.port, () => {
      console.log("\u2705 RemoteAPI Server listening on port " + opts.port);
    });
    await Promise.allSettled(extensions.map((e) => (e.beforeConnect ?? (() => {
    }))()));
    remoteAPI.on("client-connected", () => {
      Promise.allSettled(extensions.map((e) => (e.afterConnect ?? (() => {
      }))(remoteAPI)));
    });
    remoteAPI.on("client-connected", async () => {
      if (!opts.types)
        return;
      const types = await remoteAPI.getDefinitionFile();
      await import_promises3.default.writeFile(opts.types, types.result);
    });
    remoteAPI.on("client-connected", async () => {
      if (!opts.distribute)
        return;
      await Promise.allSettled(extensions.map((e) => (e.beforeDistribute ?? (() => {
      }))(remoteAPI)));
      for (const path2 in opts.distribute) {
        remoteAPI.distribute(path2, ...opts.distribute[path2]);
      }
      await Promise.allSettled(extensions.map((e) => (e.afterDistribute ?? (() => {
      }))(remoteAPI)));
    });
    remoteAPI.on("client-connected", async () => {
      if (!opts.mirror)
        return;
      const mirrors = [];
      console.log();
      for (const path2 in opts.mirror) {
        if (!(0, import_fs2.existsSync)(path2))
          await import_promises3.default.mkdir(path2, { recursive: true });
        const servers = opts.mirror[path2];
        const mirror = remoteAPI.mirror(path2, ...servers);
        remoteAPI.addListener("close", () => mirror.dispose());
        mirrors.push(mirror);
      }
      console.log();
      for (const mirror of mirrors) {
        await mirror.initFileCache();
      }
      console.log();
      for (const mirror of mirrors) {
        await mirror.syncWithRemote();
      }
      for (const mirror of mirrors) {
        mirror.watch();
      }
    });
    let queued = false;
    let startTime;
    pluginBuild.onStart(async () => {
      startTime = Date.now();
      if ((0, import_fs2.existsSync)(outdir))
        await import_promises3.default.rm(outdir, { recursive: true });
      Promise.allSettled(extensions.map((e) => (e.beforeBuild ?? (() => {
      }))()));
    });
    pluginBuild.onResolve({ filter: /^react(-dom)?$/ }, (opts2) => {
      return {
        namespace: "react",
        path: opts2.path
      };
    });
    pluginBuild.onLoad({ filter: /^react(-dom)?$/, namespace: "react" }, (opts2) => {
      if (opts2.path == "react")
        return {
          contents: "module.exports = window.React"
        };
      else if (opts2.path == "react-dom")
        return {
          contents: "module.exports = window.ReactDOM"
        };
    });
    pluginBuild.onEnd(async (result) => {
      if (result.errors.length != 0)
        return;
      if (queued)
        return;
      let endTime = Date.now();
      if (!remoteAPI.connection || !remoteAPI.connection.connected) {
        queued = true;
        console.log("Waiting for client to connect");
        await new Promise((resolve) => {
          remoteAPI.on("client-connected", () => {
            console.log("Client connected");
            resolve();
          });
        });
      }
      const files = (await import_promises3.default.readdir(outdir, { recursive: true, withFileTypes: true })).filter((file) => file.isFile()).map((file) => {
        file.path = file.path.replaceAll("\\", "/").replace(/^.*?\//, "");
        return file;
      }).map((file) => ({
        server: file.path.split("/")[0],
        filename: `${file.path}/${file.name}`.replace(/^.*?\//, ""),
        path: `${outdir}/${file.path}/${file.name}`
      }));
      if (files.length == 0)
        return;
      const promises = files.map(async ({ filename, server, path: path2 }) => remoteAPI.pushFile({
        filename,
        server,
        content: (await import_promises3.default.readFile(path2)).toString("utf8")
      }));
      await Promise.all(promises);
      const filesWithRAM = await Promise.all(files.map(async ({ filename, server }) => ({
        filename,
        server,
        cost: (await remoteAPI.calculateRAM({ filename, server })).result
      })));
      const formatOutputFiles = (files2) => {
        return files2.map((file) => `  \x1B[33m\u2022\x1B[0m ${file.server}://${file.filename} \x1B[32mRAM: ${file.cost}GB\x1B[0m`);
      };
      queued = false;
      console.log();
      console.log(formatOutputFiles(filesWithRAM).join("\n"));
      console.log();
      console.log(`\u26A1 \x1B[32mDone in \x1B[33m${endTime - startTime}ms\x1B[0m`);
      console.log();
      await Promise.allSettled(extensions.map((e) => (e.afterBuild ?? (() => {
      }))(remoteAPI)));
      return;
    });
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BitburnerPlugin
});
