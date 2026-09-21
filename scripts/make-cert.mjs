// Makes a self-signed certificate so phones on the same Wi-Fi can open Roomtone
// over https (browsers only allow the microphone on secure origins). Writes
// cert/key.pem and cert/cert.pem; the server picks them up automatically.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CERT_DIR = fileURLToPath(new URL("../cert/", import.meta.url));
const CANDIDATES = [
  "openssl",
  "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
  "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
];

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

function findOpenssl() {
  return CANDIDATES.find((bin) => spawnSync(bin, ["version"], { stdio: "ignore" }).status === 0);
}

const openssl = findOpenssl();
if (!openssl) {
  console.error("openssl was not found. Install Git for Windows (bundles it) or OpenSSL, then run `npm run cert` again.");
  process.exit(1);
}

mkdirSync(CERT_DIR, { recursive: true });
const sans = ["DNS:localhost", "IP:127.0.0.1", ...lanAddresses().map((ip) => `IP:${ip}`)].join(",");
const result = spawnSync(
  openssl,
  [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
    "-keyout", join(CERT_DIR, "key.pem"),
    "-out", join(CERT_DIR, "cert.pem"),
    "-subj", "/CN=roomtone",
    "-addext", `subjectAltName=${sans}`,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0 || !existsSync(join(CERT_DIR, "cert.pem"))) {
  console.error("openssl failed; no certificate written.");
  process.exit(1);
}
console.log(`\nWrote cert/cert.pem and cert/key.pem for ${sans}.`);
console.log("Start the server and open the https address it prints on your phone; accept the certificate warning once.");
