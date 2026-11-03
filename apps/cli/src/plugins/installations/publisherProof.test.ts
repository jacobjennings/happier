import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { encodeBase64 } from "@happier-dev/protocol";
import { createPluginInstallationManifestPublisherSigningInputV1 } from "@happier-dev/protocol/plugins/installations/manifests";
import tweetnacl from "tweetnacl";

import { signPluginInstallationPublisherHeader } from "./publisherProof";

describe("machine-installation publisher proof", () => {
  it("signs the exact GET path and canonical bodyless digest for worker reads", () => {
    const keyPair = tweetnacl.sign.keyPair();
    const encoded = signPluginInstallationPublisherHeader({
      identity: {
        version: 1,
        installationId: "installation-1",
        createdAt: 1,
        publicKey: encodeBase64(keyPair.publicKey, "base64url"),
        privateKey: encodeBase64(keyPair.secretKey, "base64url"),
      },
      machineId: "machine-1",
      method: "GET",
      path: "/v3/automations/worker/assignments",
      body: null,
    });
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

    expect(decoded.proof).toMatchObject({
      method: "GET",
      path: "/v3/automations/worker/assignments",
      machineId: "machine-1",
      installationId: "installation-1",
      bodySha256Base64Url: createHash("sha256").update("null").digest("base64url"),
    });
    const { signatureBase64Url, ...signedProof } = decoded.proof;
    expect(tweetnacl.sign.detached.verify(
      createPluginInstallationManifestPublisherSigningInputV1({ proof: signedProof }),
      Buffer.from(signatureBase64Url, "base64url"),
      keyPair.publicKey,
    )).toBe(true);
  });
});
