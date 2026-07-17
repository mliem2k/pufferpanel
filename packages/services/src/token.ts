import {
  SignJWT,
  jwtVerify,
  exportJWK,
  exportPKCS8,
  importPKCS8,
  importJWK,
  generateKeyPair,
} from "jose";

export interface NodeKeyPair {
  publicKeyJwk: Record<string, unknown>;
  privateKeyPem: string;
}

export async function generateNodeKeyPair(): Promise<NodeKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  return {
    publicKeyJwk: await exportJWK(publicKey),
    privateKeyPem: await exportPKCS8(privateKey),
  };
}

export async function signPanelToken(privateKeyPem: string): Promise<string> {
  const privateKey = await importPKCS8(privateKeyPem, "EdDSA");
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

export async function verifyPanelToken(
  token: string,
  publicKeyJwk: Record<string, unknown>,
): Promise<boolean> {
  const publicKey = await importJWK(publicKeyJwk, "EdDSA");
  try {
    await jwtVerify(token, publicKey);
    return true;
  } catch {
    return false;
  }
}
