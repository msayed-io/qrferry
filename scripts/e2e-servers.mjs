/**
 * يشغّل خوادم اختبار E2E معاً:
 *  - خادم التطبيق (vinext start على المنفذ المحدد)
 *  - خادم PeerJS محلي (منفذ 9000) للاقتران — يضمن استقرار اختبارات النقل السريع
 */
import { spawn } from "node:child_process";
import process from "node:process";

const PORT = process.env.E2E_PORT ?? "3100";
const PEER_PORT = process.env.PEER_PORT ?? "9000";

const children = [];

function run(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: false,
  });
  children.push(child);
  child.on("exit", (code) => {
    console.error(`[e2e-servers] ${name} exited with code ${code}`);
    for (const other of children) {
      if (other !== child && !other.killed) other.kill();
    }
    process.exit(code ?? 1);
  });
}

run("vinext", "npm", ["run", "start"], { PORT });
run("peerjs", "npx", ["peer", "--port", PEER_PORT]);

const shutdown = () => {
  for (const child of children) if (!child.killed) child.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
