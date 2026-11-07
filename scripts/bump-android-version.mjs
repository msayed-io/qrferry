import { readFile, writeFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const [major, minor, patch] = packageJson.version.split('.').map(Number);
if (![major, minor, patch].every(Number.isInteger)) {
  throw new Error(`Invalid semantic version: ${packageJson.version}`);
}
const versionCode = major * 10000 + minor * 100 + patch;
const gradlePath = 'android/app/build.gradle';
let gradle = await readFile(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${packageJson.version}"`);
await writeFile(gradlePath, gradle);
console.log(JSON.stringify({ version: packageJson.version, versionCode }));
