import { describe, expect, test } from "bun:test";
import { TtyEnvironmentImpl, tokenizeCommand } from "./tty-environment";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
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
    }, 20);
  });
}

describe("TtyEnvironmentImpl", () => {
  test("captures stdout lines from a real spawned process", async () => {
    const impl = new TtyEnvironmentImpl();
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    await impl.executeAsync({ command: "echo hello-from-tty", cwd: "." });
    await waitFor(() => lines.includes("hello-from-tty"));
    expect(lines).toContain("hello-from-tty");
    await impl.kill();
  });

  test("isRunning reflects the real process lifecycle", async () => {
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "sleep 5", cwd: "." });
    expect(await impl.isRunning()).toBe(true);
    await impl.kill();
    await waitFor(async () => !(await impl.isRunning()));
    expect(await impl.isRunning()).toBe(false);
  });

  test("onExit fires when the process is killed", async () => {
    const impl = new TtyEnvironmentImpl();
    let exited = false;
    impl.onExit(() => {
      exited = true;
    });
    await impl.executeAsync({ command: "sleep 5", cwd: "." });
    await impl.kill();
    await waitFor(() => exited);
    expect(exited).toBe(true);
  });

  test("sendCommand writes to the process's stdin", async () => {
    const impl = new TtyEnvironmentImpl();
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    await impl.executeAsync({ command: "cat", cwd: "." });
    await impl.sendCommand("echo-me-back");
    await waitFor(() => lines.includes("echo-me-back"));
    expect(lines).toContain("echo-me-back");
    await impl.kill();
  });

  test("getStats returns real CPU/memory numbers for a running process", async () => {
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "sleep 5", cwd: "." });
    const stats = await impl.getStats();
    expect(typeof stats.cpu).toBe("number");
    expect(typeof stats.memory).toBe("number");
    expect(stats.memory).toBeGreaterThan(0);
    await impl.kill();
  });

  test("isRunning and getStats handle a process that exits on its own without throwing", async () => {
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "true", cwd: "." });
    // Deliberately check immediately, with no polling delay: "true" typically finishes
    // and gets reaped before this line runs, landing right in the TOCTOU window between
    // the process actually exiting and any fire-and-forget bookkeeping catching up.
    // getStats() must never throw here, even though the process may already be gone.
    const stats = await impl.getStats();
    expect(stats).toEqual({ cpu: 0, memory: 0 });
    // Once the process has genuinely settled, isRunning() must reflect that too.
    await waitFor(async () => !(await impl.isRunning()));
    expect(await impl.isRunning()).toBe(false);
  });
});

describe("tokenizeCommand", () => {
  test("a normal single-spaced command tokenizes exactly like split(\" \") did (no regression)", () => {
    expect(tokenizeCommand("java -jar purpur.jar --nogui")).toEqual(["java", "-jar", "purpur.jar", "--nogui"]);
    expect(tokenizeCommand("sleep 5")).toEqual(["sleep", "5"]);
    expect(tokenizeCommand("echo hi")).toEqual(["echo", "hi"]);
  });

  test("a quoted argument containing a space tokenizes to one argv entry, quotes stripped", () => {
    expect(tokenizeCommand('java -jar "my server.jar" --nogui')).toEqual([
      "java",
      "-jar",
      "my server.jar",
      "--nogui",
    ]);
  });

  test("accidental double spaces don't produce an empty-string token", () => {
    expect(tokenizeCommand("java  -jar  purpur.jar")).toEqual(["java", "-jar", "purpur.jar"]);
    // Leading/trailing whitespace shouldn't produce empty tokens either.
    expect(tokenizeCommand("  java -jar purpur.jar  ")).toEqual(["java", "-jar", "purpur.jar"]);
  });
});

describe("TtyEnvironmentImpl.executeAsync argument tokenization against a real spawned process", () => {
  test("a quoted argument survives as one real argv entry, not split apart", async () => {
    const impl = new TtyEnvironmentImpl();
    const lines: string[] = [];
    impl.onConsoleLine((line) => lines.push(line));
    // /usr/bin/printf is a real standalone binary (unlike the shell builtin),
    // so this genuinely exercises Bun.spawn's argv, not a shell re-parsing
    // the string. Format "%s\n" recycles for each extra argument: if the
    // quoted argument were wrongly split into two tokens (the pre-fix
    // behavior), this would print 3 lines with stray quote characters
    // instead of 2 clean lines.
    await impl.executeAsync({ command: '/usr/bin/printf %s\\n "my server.jar" --nogui', cwd: "." });
    await waitFor(() => lines.length >= 2);
    expect(lines.slice(0, 2)).toEqual(["my server.jar", "--nogui"]);
    await impl.kill();
  });
});

describe("TtyEnvironmentImpl PID file", () => {
  test("writes the process pid to pidFilePath on spawn", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-tty-pidfile-"));
    const pidFilePath = join(dataDir, "server.pid");
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "sleep 5", cwd: ".", pidFilePath });
    const written = await readFile(pidFilePath, "utf-8");
    expect(Number(written)).toBeGreaterThan(0);
    await impl.kill();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("removes the pid file on clean exit", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfp-tty-pidfile-"));
    const pidFilePath = join(dataDir, "server.pid");
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "true", cwd: ".", pidFilePath });
    await waitFor(async () => !(await Bun.file(pidFilePath).exists()));
    expect(await Bun.file(pidFilePath).exists()).toBe(false);
    await rm(dataDir, { recursive: true, force: true });
  });

  test("does not attempt to write a pid file when pidFilePath is omitted (no regression)", async () => {
    const impl = new TtyEnvironmentImpl();
    await impl.executeAsync({ command: "sleep 5", cwd: "." });
    expect(await impl.isRunning()).toBe(true);
    await impl.kill();
  });
});
