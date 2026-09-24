import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lobbyRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDir = path.join(lobbyRoot, "certs");

function lanIpv4() {
  const ips = ["127.0.0.1"];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return [...new Set(ips)];
}

export function ensureTlsMaterial(config) {
  const dir = config.tlsDir || defaultDir;
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  fs.mkdirSync(dir, { recursive: true });

  const ips = lanIpv4();
  const san = ["DNS:localhost", ...ips.map((ip) => `IP:${ip}`)].join(",");
  const stampPath = path.join(dir, "san.txt");
  const previous = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, "utf8") : "";
  const needsNew = !fs.existsSync(keyPath) || !fs.existsSync(certPath) || previous !== san;

  if (needsNew) {
    const result = spawnSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048",
      "-keyout", keyPath,
      "-out", certPath,
      "-days", "825",
      "-nodes",
      "-subj", "/CN=ps1-rooms",
      "-addext", `subjectAltName=${san}`,
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || "openssl failed to create lobby TLS cert");
    }
    fs.writeFileSync(stampPath, san);
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    ips,
  };
}
