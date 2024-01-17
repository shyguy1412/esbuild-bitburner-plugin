export interface LogBatcher {
  logs: any[][];
  log(...args: Parameters<typeof console['log']>): this;
  dispatch(): void;
}

export function createLogBatch(): LogBatcher {
  return {
    logs: [] as any[][],
    log(...args: Parameters<typeof console['log']>) {
      this.logs.push(args);
      return this;
    },
    dispatch() {
      while (this.logs.length) {
        console.log(...this.logs.shift()!);
      }
    }
  };
}