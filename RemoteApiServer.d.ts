export = RemoteApiServer;
import WebSocket = require('websocket');
declare class RemoteApiServer extends WebSocket.server {
    getId(): number;
    listen(port: number, callback: () => void): void;
    mirror(targetPath: string, ...servers: string[]): RemoteFileMirror;
    distribute(targetPath: string, ...servers: string[]): RemoteFileMirror;
    write(obj: any): Promise<any>;
    getDefinitionFile(): Promise<any>;
    pushFile({ filename, content, server }: {
        filename: string;
        content: string;
        server: string;
    }): Promise<any>;
    getFile({ filename, server }: {
        filename: string;
        server: string;
    }): Promise<any>;
    getFileNames(server: string): Promise<any>;
    getAllFiles(server: string): Promise<any>;
    deleteFile({ filename, server }: {
        filename: string;
        server: string;
    }): Promise<any>;
    calculateRAM({ filename, server }: {
        filename: string;
        server: string;
    }): Promise<any>;
    #private;
}
import RemoteFileMirror = require("./RemoteFileMirror");
