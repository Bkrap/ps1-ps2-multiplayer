import { spawn } from "node:child_process";
import fs from "node:fs";

function run(command, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

export function createDockerRunner(config) {
  return {
    async ensureNetwork() {
      await run("docker", ["network", "create", config.dockerNetwork]).catch((error) => {
        if (!/already exists/i.test(error.message)) throw error;
      });
    },

    async start(room) {
      await this.ensureNetwork();
      // Leftover containers from a killed lobby block `docker run --name`.
      await run("docker", ["rm", "-f", room.containerName]).catch(() => {});
      const system = String(room.game.system || "ps1").toLowerCase();
      const isPs2 = system === "ps2";
      const gamesDir = isPs2 ? config.gamesDirPs2 : config.gamesDir;
      const biosDir = isPs2 ? config.biosDirPs2 : config.biosDir;
      const cpus = isPs2 ? config.roomCpusPs2 : config.roomCpus;
      const memory = isPs2 ? config.roomMemoryPs2 : config.roomMemory;
      const args = [
        "run", "-d",
        "--name", room.containerName,
        "--network", config.dockerNetwork,
        "--cpus", String(cpus),
        "--memory", String(memory),
        "--shm-size", "1g",
        "--security-opt", "no-new-privileges:true",
        // Lobby runs on the host, so publish the stream port on localhost.
        "-p", "127.0.0.1::3000",
        "--label", "ps1.room=1",
        "--label", `ps1.code=${room.code}`,
        "-v", `${gamesDir}:/games:ro,z`,
        "-v", `${biosDir}:/bios:ro,z`,
        "-e", `GAME_SYSTEM=${system}`,
        "-e", `GAME_FILE=${room.game.file}`,
        "-e", `SELKIES_MASTER_TOKEN=${room.masterToken}`,
        "-e", `SUBFOLDER=/streams/${room.code}/`,
        "-e", "PUID=1000",
        "-e", "PGID=1000",
      ];
      if (fs.existsSync("/dev/uinput")) {
        args.push("--device", "/dev/uinput:/dev/uinput");
      }
      args.push(config.roomImage);
      await run("docker", args);
      const { stdout } = await run("docker", ["port", room.containerName, "3000/tcp"]);
      const match = stdout.trim().match(/:(\d+)\s*$/m);
      if (!match) throw new Error("match container did not publish a stream port");
      room.hostPort = Number(match[1]);
    },

    async stop(room) {
      room.hostPort = null;
      await run("docker", ["rm", "-f", room.containerName]).catch(() => {});
    },

    async waitReady(room) {
      // Nginx answers on :3000 before Selkies opens the token API.
      // Wait for a successful token push, not just the HTML page.
      const deadline = Date.now() + 120000;
      let lastError = "match container did not open its stream control port";
      while (Date.now() < deadline) {
        try {
          await run("docker", [
            "exec", room.containerName, "curl", "-fsS", "-o", "/dev/null",
            `http://127.0.0.1:3000/streams/${room.code}/`,
          ]);
          await this.pushTokens(room, {});
          return;
        } catch (error) {
          lastError = error.message;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      throw new Error(lastError);
    },

    async pushTokens(room, body) {
      // Selkies 2.x: control plane is :8082 under SUBFOLDER (/streams/{code}/api/tokens).
      const tokensUrl = `http://127.0.0.1:8082/streams/${room.code}/api/tokens`;
      await run("docker", [
        "exec", "-i", room.containerName,
        "curl", "-fsS", "-X", "POST", tokensUrl,
        "-H", `Authorization: Bearer ${room.masterToken}`,
        "-H", "Content-Type: application/json",
        "--data-binary", "@-",
      ], { input: JSON.stringify(body) });
    },

    async startRecording(room) {
      await run("docker", ["exec", room.containerName, "/defaults/record-start.sh"]);
    },

    async stopRecording(room) {
      await run("docker", ["exec", room.containerName, "/defaults/record-stop.sh"]).catch(() => {});
    },

    async recordingActive(room) {
      try {
        const { stdout } = await run("docker", [
          "exec", room.containerName, "bash", "-lc",
          'pid=$(cat /tmp/ps1-record.pid 2>/dev/null); test -n "$pid" && kill -0 "$pid" 2>/dev/null && test -s /tmp/ps1-match.mp4 && echo yes || echo no',
        ]);
        return stdout.trim() === "yes";
      } catch {
        return false;
      }
    },

    async pullRecording(room, destPath) {
      await run("docker", ["cp", `${room.containerName}:/tmp/ps1-match.mp4`, destPath]);
      if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 1024) {
        throw new Error("recording file missing or too small");
      }
      return destPath;
    },

    streamTarget(room) {
      if (!room.hostPort) return null;
      return `http://127.0.0.1:${room.hostPort}`;
    },

    async stats() {
      const { stdout } = await run("docker", [
        "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}}",
      ]);
      return stdout.split("\n").map((line) => {
        const match = line.trim().match(/^(\S+)\s+([0-9.]+)%$/);
        if (!match || !match[1].startsWith("ps1-room-")) return null;
        return { name: match[1], cpuPercent: Number(match[2]) };
      }).filter(Boolean);
    },
  };
}

export function createPreviewRunner() {
  const containers = new Map();
  return {
    containers,
    async ensureNetwork() {},
    async start(room) {
      containers.set(room.containerName, { running: true, tokens: null, recording: false });
    },
    async stop(room) {
      containers.delete(room.containerName);
    },
    async waitReady() {},
    async pushTokens(room, body) {
      const container = containers.get(room.containerName);
      if (container) container.tokens = body;
    },
    async startRecording(room) {
      const container = containers.get(room.containerName);
      if (container) container.recording = true;
    },
    async stopRecording(room) {
      const container = containers.get(room.containerName);
      if (container) container.recording = false;
    },
    async recordingActive(room) {
      return Boolean(containers.get(room.containerName)?.recording);
    },
    async pullRecording() {
      throw new Error("preview mode has no recording file");
    },
    streamTarget() {
      return null;
    },
    async stats() {
      return [];
    },
  };
}
