import { describe, expect, test } from "bun:test";
import { generateNodeKeyPair, signPanelToken, verifyPanelToken } from "./node-token";

describe("token service", () => {
  test("a token signed with the private key verifies against the matching public key", async () => {
    const { publicKeyJwk, privateKeyPem } = await generateNodeKeyPair();
    const token = await signPanelToken(privateKeyPem);
    expect(await verifyPanelToken(token, publicKeyJwk)).toBe(true);
  });

  test("a token does not verify against a different keypair's public key", async () => {
    const { privateKeyPem } = await generateNodeKeyPair();
    const otherKeyPair = await generateNodeKeyPair();
    const token = await signPanelToken(privateKeyPem);
    expect(await verifyPanelToken(token, otherKeyPair.publicKeyJwk)).toBe(false);
  });
});
