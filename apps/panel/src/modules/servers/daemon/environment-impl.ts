export interface ExecutionData {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  pidFilePath?: string;
  image?: string;
}

export interface ServerStats {
  cpu: number;
  memory: number;
}

export interface EnvironmentImpl {
  executeAsync(data: ExecutionData): Promise<void>;
  kill(): Promise<void>;
  getStats(): Promise<ServerStats>;
  sendCode(signal: string): Promise<void>;
  sendCommand(command: string): Promise<void>;
  getUid(): number;
  getGid(): number;
  isRunning(): Promise<boolean>;
  onConsoleLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
}
