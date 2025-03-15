type RemoteApiServer = import('./lib/RemoteApiServer').RemoteApiServer;

declare type BitburnerPluginOptions = Partial<{
  /**
   * This is the port the RemoteAPI will connect to.
   * Enter the same port inside your game options to connect to your editor.
   */
  port: number;
  /**
   * This is the path that the Netscript Definitions file will be placed at.
   */
  types: string;
  /**
   * Set this to true to poll the filessytem instead of using filesystem events.
   * This can fix issues when using WSL but having the project inside the Windows filesystem.
   */
  usePolling: boolean;
  /**
   * Sets the interval for the filesystem polling
   * Only used when usePolling is set to true.
   */
  pollingInterval: number;
  /**
   * Set this to true to push mirrored files on connect.
   * By default the file mirror pulls the ingame files on connect, overriding local files with the current ingame state.
   */
  pushOnConnect: boolean;
  /**
   * Use this to map a local directory to a list of ingame servers.
   * All the listed servers will be mirrored into that directory.
   */
  mirror: {
    [path: string]: string[] | 'all' | 'own' | 'other';
  };
  /**
   * Use this to map a local directory to multiple servers.
   * All files in that directory will be uploaded to all of the listed servers.
   */
  distribute: {
    [path: string]: string[] | 'all' | 'own' | 'other';
  };
  /**
   * A list of extensions for the Plugin to supplement and customize features.
   */
  extensions: {
    setup?: () => void | Promise<void>;

    beforeConnect?: () => void | Promise<void>;
    afterConnect?: (remoteAPI: RemoteApiServer) => void | Promise<void>;

    beforeBuild?: () => void | Promise<void>;
    afterBuild?: (remoteAPI: RemoteApiServer) => void | Promise<void>;
  }[];
  /**
   * Enable remote debugging. This will automatically set the right esbuild options if they arent set already.
   */
  remoteDebugging: boolean;
}>;

declare type PluginExtension = NonNullable<
  BitburnerPluginOptions['extensions']
>[number];
