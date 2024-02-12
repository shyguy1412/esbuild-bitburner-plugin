import { formatMessagesSync } from "esbuild";

export interface LogBatcher {
  logs: any[][];
  log(...args: Parameters<typeof console['log']>): this;
  error(...args: string[]): this;
  warn(...args: string[]): this;
  dispatch(): void;
}

export function createLogBatch(): LogBatcher {
  return {
    logs: [] as any[][],
    log(...args: Parameters<typeof console['log']>) {
      this.logs.push(args);
      return this;
    },
    error(...messages: string[]) {
      this.logs.push(formatMessagesSync(messages.map(text => ({ text })), { kind: 'error', color: true }));
      return this;
    },
    warn(...messages: string[]) {
      this.logs.push(formatMessagesSync(messages.map(text => ({ text })), { kind: 'warning', color: true }));
      return this;
    },
    dispatch() {
      while (this.logs.length) {
        console.log(...this.logs.shift()!);
      }
    }
  };
}