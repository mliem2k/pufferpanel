import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { generateNodeKeyPair, signPanelToken } from "./node-token";
import { createNodeAuthPlugin } from "./node-auth-plugin";

function buildTestApp(publicKeyJwk: Record<string, unknown>) {
  return new Elysia().use(createNodeAuthPlugin(publicKeyJwk)).get("/ping", () => ({ pong: true }));
}

describe("createNodeAuthPlugin", () => {
  test("rejects a request with no Authorization header", async () => {
    const { publicKeyJwk } = await generateNodeKeyPair();
    const app = buildTestApp(publicKeyJwk);
    const response = await app.handle(new Request("http://localhost/ping"));
    expect(response.status).toBe(401);
  });

  test("rejects a malformed Authorization header", async () => {
    const { publicKeyJwk } = await generateNodeKeyPair();
    const app = buildTestApp(publicKeyJwk);
    const response = await app.handle(
      new Request("http://localhost/ping", { headers: { authorization: "not-a-bearer-token" } }),
    );
    expect(response.status).toBe(401);
  });

  test("rejects a token signed with the wrong keypair", async () => {
    const { publicKeyJwk } = await generateNodeKeyPair();
    const otherKeyPair = await generateNodeKeyPair();
    const token = await signPanelToken(otherKeyPair.privateKeyPem);
    const app = buildTestApp(publicKeyJwk);
    const response = await app.handle(
      new Request("http://localhost/ping", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(response.status).toBe(401);
  });

  test("accepts a token signed with the matching private key", async () => {
    const { publicKeyJwk, privateKeyPem } = await generateNodeKeyPair();
    const token = await signPanelToken(privateKeyPem);
    const app = buildTestApp(publicKeyJwk);
    const response = await app.handle(
      new Request("http://localhost/ping", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pong: true });
  });
});
