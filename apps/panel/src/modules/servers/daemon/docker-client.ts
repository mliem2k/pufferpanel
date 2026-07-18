const DEFAULT_SOCKET_PATH = "/var/run/docker.sock";

function socketPath(): string {
  return process.env.PANEL_DOCKER_SOCKET ?? DEFAULT_SOCKET_PATH;
}

export async function dockerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://localhost${path}`, { ...init, unix: socketPath() } as RequestInit & { unix: string });
}

export interface DockerFrame {
  streamType: number;
  payload: Uint8Array;
}

// Docker's multiplexed stream format: an 8-byte header per frame (1 byte
// stream type - 0 stdin, 1 stdout, 2 stderr; 3 padding bytes; 4-byte
// big-endian payload length), followed by that many bytes of payload. A
// single chunk of socket data can contain multiple frames, or a partial
// frame split across chunks anywhere (including mid-header) - callers must
// feed every chunk through the SAME DockerFrameDemuxer instance in order.
export class DockerFrameDemuxer {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): DockerFrame[] {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);
    this.buffer = combined;

    const frames: DockerFrame[] = [];
    for (;;) {
      if (this.buffer.length < 8) break;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.length);
      const streamType = view.getUint8(0);
      const length = view.getUint32(4, false);
      if (this.buffer.length < 8 + length) break;
      const payload = this.buffer.slice(8, 8 + length);
      frames.push({ streamType, payload });
      this.buffer = this.buffer.slice(8 + length);
    }
    return frames;
  }
}

export interface AttachConnection {
  write(data: string | Uint8Array): void;
  onData(listener: (chunk: Uint8Array) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

const CRLFCRLF = [13, 10, 13, 10];

function indexOfSequence(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// The /attach endpoint hijacks the HTTP connection into a raw duplex byte
// stream once it responds "101 UPGRADED" - fetch() can't represent this (it
// isn't a normal request/response), so this speaks the upgrade handshake by
// hand over a raw Bun.connect() unix socket.
export function attach(containerId: string): Promise<AttachConnection> {
  return new Promise((resolve, reject) => {
    let dataListener: ((chunk: Uint8Array) => void) | null = null;
    let closeListener: (() => void) | null = null;
    let resolved = false;
    let headerBuffer = new Uint8Array(0);
    let sawUpgrade = false;

    const path = `/containers/${containerId}/attach?stream=1&stdin=1&stdout=1&stderr=1`;

    Bun.connect({
      unix: socketPath(),
      socket: {
        data(socket, chunk) {
          if (!sawUpgrade) {
            const combined = new Uint8Array(headerBuffer.length + chunk.length);
            combined.set(headerBuffer, 0);
            combined.set(chunk, headerBuffer.length);
            headerBuffer = combined;
            const headerEnd = indexOfSequence(headerBuffer, CRLFCRLF);
            if (headerEnd === -1) return;
            sawUpgrade = true;
            const remainder = headerBuffer.slice(headerEnd + CRLFCRLF.length);
            if (!resolved) {
              resolved = true;
              resolve({
                write: (data) => {
                  socket.write(data);
                },
                onData: (listener) => {
                  dataListener = listener;
                },
                onClose: (listener) => {
                  closeListener = listener;
                },
                close: () => {
                  socket.end();
                },
              });
            }
            if (remainder.length > 0) {
              dataListener?.(remainder);
            }
            return;
          }
          dataListener?.(chunk);
        },
        open(socket) {
          socket.write(
            `POST ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/vnd.docker.raw-stream\r\n\r\n`,
          );
        },
        close() {
          closeListener?.();
        },
        error(_socket, error) {
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        },
      },
    });
  });
}
