import { access, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function listFilesRecursive(directory: string): Promise<string[]> {
  const output: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFilesRecursive(full)));
    } else {
      output.push(full);
    }
  }
  return output;
}

/**
 * يولّد قائمة الأصول المجزّأة (JavaScript / CSS / WebAssembly / الخطوط)
 * في `dist/client/asset-manifest.json` (جذر الخدمة الثابتة) حتى يخزّنها
 * الـ service worker مسبقاً وتعمل التطبيقات دون اتصال بعد أول زيارة.
 */
async function writeAssetManifest(root: string): Promise<void> {
  const clientAssets = resolve(root, "dist", "client", "assets");
  if (!(await exists(clientAssets))) return;
  const files = await listFilesRecursive(clientAssets);
  const manifest = files
    .map((file) => `/assets/${relative(clientAssets, file).split("\\").join("/")}`)
    .sort();
  const target = resolve(root, "dist", "client", "asset-manifest.json");
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

// Packages Sites metadata and migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    async closeBundle() {
      const outputDirectory = resolve(root, "dist", ".openai");
      const hostingConfig = resolve(root, ".openai", "hosting.json");
      const drizzleSource = resolve(root, "drizzle");

      await rm(outputDirectory, { recursive: true, force: true });
      await mkdir(outputDirectory, { recursive: true });

      if (await exists(hostingConfig)) {
        await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
      }
      if (await exists(drizzleSource)) {
        await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
          recursive: true,
        });
      }

      await writeAssetManifest(root);
    },
  };
}
