import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recommendMaxRooms } from "../lobby/src/capacity.js";
import { createDockerRunner } from "../lobby/src/docker.js";
import { loadConfig } from "../lobby/src/config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig({ ...process.env, PREVIEW: "false" });
let samples = [];
try {
  samples = await createDockerRunner(config).stats();
} catch {
  samples = [];
}

const result = recommendMaxRooms({
  hostCpus: Number(process.env.HOST_CPUS || os.cpus().length || 6),
  samples,
});
const out = path.join(root, "deploy", "max-rooms.measured");
fs.writeFileSync(out, `${JSON.stringify({ ...result, samples: samples.length }, null, 2)}\n`);

const envPath = path.join(root, ".env");
if (result.measured && fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, "utf8");
  const next = env.match(/^MAX_ROOMS=/m)
    ? env.replace(/^MAX_ROOMS=.*/m, `MAX_ROOMS=${result.maxRooms}`)
    : `${env.trim()}\nMAX_ROOMS=${result.maxRooms}\n`;
  fs.writeFileSync(envPath, next);
}

console.log(JSON.stringify(result));
if (!result.measured) {
  console.log("No live rooms to measure. MAX_ROOMS stays at 2 until two matches are running.");
}
