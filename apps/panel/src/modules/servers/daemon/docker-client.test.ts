import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerFetch, DockerFrameDemuxer, attach, findContainer } from "./docker-client";

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (await check()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error("waitFor timed out"));
      }
    }, 25);
  });
}

describe("dockerFetch", () => {
  test("reaches the real Docker daemon over the unix socket", async () => {
    const res = await dockerFetch("/version");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ApiVersion: string };
    expect(typeof body.ApiVersion).toBe("string");
  });

  test("creates, starts, inspects, and removes a real container", async () => {
    const name = `pfp-docker-client-test-${Date.now()}`;
    try {
      const createRes = await dockerFetch(`/containers/create?name=${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Image: "alpine:latest",
          Cmd: ["sh", "-c", "sleep 30"],
          HostConfig: { NetworkMode: "host" },
        }),
      });
      expect(createRes.status).toBe(201);
      const { Id } = (await createRes.json()) as { Id: string };
      expect(typeof Id).toBe("string");

      const startRes = await dockerFetch(`/containers/${Id}/start`, { method: "POST" });
      expect(startRes.status).toBe(204);

      await waitFor(async () => {
        const inspectRes = await dockerFetch(`/containers/${Id}/json`);
        const inspect = (await inspectRes.json()) as { State: { Running: boolean } };
        return inspect.State.Running === true;
      });

      const statsRes = await dockerFetch(`/containers/${Id}/stats?stream=false`);
      const stats = (await statsRes.json()) as { memory_stats: { usage: number } };
      expect(typeof stats.memory_stats.usage).toBe("number");
      expect(stats.memory_stats.usage).toBeGreaterThan(0);

      const killRes = await dockerFetch(`/containers/${Id}/kill`, { method: "POST" });
      expect(killRes.status).toBe(204);
    } finally {
      await dockerFetch(`/containers/${name}?force=true`, { method: "DELETE" }).catch(() => {});
    }
  });
});

describe("DockerFrameDemuxer", () => {
  function frame(streamType: number, text: string): Uint8Array {
    const payload = new TextEncoder().encode(text);
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint8(0, streamType);
    view.setUint32(4, payload.length, false);
    const out = new Uint8Array(8 + payload.length);
    out.set(header, 0);
    out.set(payload, 8);
    return out;
  }

  test("parses a single complete frame from one chunk", () => {
    const demuxer = new DockerFrameDemuxer();
    const frames = demuxer.push(frame(1, "hello\n"));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.streamType).toBe(1);
    expect(new TextDecoder().decode(frames[0]!.payload)).toBe("hello\n");
  });

  test("parses two frames concatenated in one chunk", () => {
    const demuxer = new DockerFrameDemuxer();
    const a = frame(1, "line-one\n");
    const b = frame(2, "line-two\n");
    const combined = new Uint8Array(a.length + b.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    const frames = demuxer.push(combined);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.streamType).toBe(1);
    expect(new TextDecoder().decode(frames[0]!.payload)).toBe("line-one\n");
    expect(frames[1]!.streamType).toBe(2);
    expect(new TextDecoder().decode(frames[1]!.payload)).toBe("line-two\n");
  });

  test("reassembles a frame split across two chunks (header split)", () => {
    const demuxer = new DockerFrameDemuxer();
    const full = frame(1, "split-frame\n");
    const firstPart = full.slice(0, 5);
    const secondPart = full.slice(5);
    expect(demuxer.push(firstPart)).toHaveLength(0);
    const frames = demuxer.push(secondPart);
    expect(frames).toHaveLength(1);
    expect(new TextDecoder().decode(frames[0]!.payload)).toBe("split-frame\n");
  });

  test("reassembles a frame split across two chunks (payload split)", () => {
    const demuxer = new DockerFrameDemuxer();
    const full = frame(1, "payload-split-frame\n");
    const firstPart = full.slice(0, 10);
    const secondPart = full.slice(10);
    expect(demuxer.push(firstPart)).toHaveLength(0);
    const frames = demuxer.push(secondPart);
    expect(frames).toHaveLength(1);
    expect(new TextDecoder().decode(frames[0]!.payload)).toBe("payload-split-frame\n");
  });
});

describe("attach", () => {
  test("writing to a real container's stdin echoes back through stdout", async () => {
    const name = `pfp-docker-client-attach-${Date.now()}`;
    let containerId: string | null = null;
    try {
      const createRes = await dockerFetch(`/containers/create?name=${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Image: "alpine:latest",
          Cmd: ["sh", "-c", "cat"],
          HostConfig: { NetworkMode: "host" },
          OpenStdin: true,
          StdinOnce: false,
          Tty: false,
        }),
      });
      const created = (await createRes.json()) as { Id: string };
      containerId = created.Id;
      await dockerFetch(`/containers/${containerId}/start`, { method: "POST" });

      const connection = await attach(containerId!);
      const demuxer = new DockerFrameDemuxer();
      const lines: string[] = [];
      let buffer = "";
      connection.onData((chunk) => {
        for (const f of demuxer.push(chunk)) {
          buffer += new TextDecoder().decode(f.payload);
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";
          lines.push(...parts);
        }
      });
      connection.write("echo-me-back\n");
      await waitFor(() => lines.includes("echo-me-back"));
      expect(lines).toContain("echo-me-back");
      connection.close();
    } finally {
      if (containerId) {
        await dockerFetch(`/containers/${containerId}?force=true`, { method: "DELETE" }).catch(() => {});
      }
    }
  });

  test("the attach connection closes when the container is killed", async () => {
    const name = `pfp-docker-client-exit-${Date.now()}`;
    let containerId: string | null = null;
    try {
      const createRes = await dockerFetch(`/containers/create?name=${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Image: "alpine:latest",
          Cmd: ["sh", "-c", "sleep 30"],
          HostConfig: { NetworkMode: "host" },
          OpenStdin: true,
          Tty: false,
        }),
      });
      const created = (await createRes.json()) as { Id: string };
      containerId = created.Id;
      await dockerFetch(`/containers/${containerId}/start`, { method: "POST" });

      const connection = await attach(containerId!);
      let closed = false;
      connection.onClose(() => {
        closed = true;
      });

      await dockerFetch(`/containers/${containerId}/kill`, { method: "POST" });
      await waitFor(() => closed);
      expect(closed).toBe(true);
    } finally {
      if (containerId) {
        await dockerFetch(`/containers/${containerId}?force=true`, { method: "DELETE" }).catch(() => {});
      }
    }
  });

  test("rejects when the target container doesn't exist", async () => {
    await expect(attach("nonexistent-container-id-12345")).rejects.toThrow();
  });

  test("does not lose payload bytes that arrive in the same chunk as the header terminator", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-docker-attach-fake-"));
    const fakeSocketPath = join(dataDir, "fake.sock");
    const originalEnv = process.env.PANEL_DOCKER_SOCKET;
    process.env.PANEL_DOCKER_SOCKET = fakeSocketPath;

    const server = Bun.listen({
      unix: fakeSocketPath,
      socket: {
        data(socket) {
          // Respond with the upgrade header AND a payload frame in ONE write,
          // reproducing the exact byte-timing this test exists to cover.
          const payload = new TextEncoder().encode("immediate-frame-payload");
          const header = new Uint8Array(8);
          const view = new DataView(header.buffer);
          view.setUint8(0, 1);
          view.setUint32(4, payload.length, false);
          const frame = new Uint8Array(8 + payload.length);
          frame.set(header, 0);
          frame.set(payload, 8);

          const responseText =
            "HTTP/1.1 101 UPGRADED\r\nConnection: Upgrade\r\nContent-Type: application/vnd.docker.multiplexed-stream\r\nUpgrade: tcp\r\n\r\n";
          const responseHeader = new TextEncoder().encode(responseText);
          const combined = new Uint8Array(responseHeader.length + frame.length);
          combined.set(responseHeader, 0);
          combined.set(frame, responseHeader.length);
          socket.write(combined);
        },
        open() {},
        close() {},
        error() {},
      },
    });

    try {
      const connection = await attach("any-id-the-fake-server-ignores");
      const received: Uint8Array[] = [];
      connection.onData((chunk) => received.push(chunk));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(received.length).toBeGreaterThan(0);
      const allBytes = received.reduce((acc, c) => acc + c.length, 0);
      expect(allBytes).toBeGreaterThan(8);
    } finally {
      server.stop(true);
      if (originalEnv === undefined) {
        delete process.env.PANEL_DOCKER_SOCKET;
      } else {
        process.env.PANEL_DOCKER_SOCKET = originalEnv;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe("findContainer", () => {
  test("returns null for a name that doesn't exist", async () => {
    const result = await findContainer(`pfp-docker-client-missing-${Date.now()}`);
    expect(result).toBeNull();
  });

  test("returns the id and running state for a real running container", async () => {
    const name = `pfp-docker-client-find-${Date.now()}`;
    let containerId: string;
    try {
      const createRes = await dockerFetch(`/containers/create?name=${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Image: "alpine:latest",
          Cmd: ["sh", "-c", "sleep 30"],
          HostConfig: { NetworkMode: "host" },
        }),
      });
      const created = (await createRes.json()) as { Id: string };
      containerId = created.Id;
      await dockerFetch(`/containers/${containerId}/start`, { method: "POST" });

      const result = await findContainer(name);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(containerId);
      expect(result?.running).toBe(true);
    } finally {
      await dockerFetch(`/containers/${name}?force=true`, { method: "DELETE" }).catch(() => {});
    }
  });
});
