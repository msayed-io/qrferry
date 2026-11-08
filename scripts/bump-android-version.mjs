import { readFile, writeFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const [major, minor, patch] = packageJson.version.split('.').map(Number);
if (![major, minor, patch].every(Number.isInteger)) {
  throw new Error(`Invalid semantic version: ${packageJson.version}`);
}

const gradlePath = 'android/app/build.gradle';
let gradle = await readFile(gradlePath, 'utf8');
const previous = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const versionCode = previous + 1;
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('Invalid Android versionCode.');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${packageJson.version}"`);
await writeFile(gradlePath, gradle);
console.log(JSON.stringify({ version: packageJson.version, versionCode }));
