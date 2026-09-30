import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const local = path.join(root, "integration.config.local.json");
if (!fs.existsSync(local)) {
  throw new Error("Create integration.config.local.json from integration/config/local.example.json first.");
}
const config = JSON.parse(fs.readFileSync(local, "utf8"));
for (const field of ["rootFolderId", "inboxFolderId", "oauthClientId", "extensionPublicKey"]) {
  if (!config[field]) throw new Error(`Missing ${field}; configuration is incomplete.`);
}
if (!/^[A-Za-z0-9_-]+$/.test(config.rootFolderId) || !/^[A-Za-z0-9_-]+$/.test(config.inboxFolderId)) throw new Error("Invalid folder ID");
if (!config.oauthClientId.endsWith(".apps.googleusercontent.com")) throw new Error("Invalid Google OAuth client ID");
// Account configuration is private local build input, never tracked source.
fs.writeFileSync(path.join(root, "src/pages/Background/drive/libraryConfig.local.json"), JSON.stringify({enabled:true,rootFolderId:config.rootFolderId,inboxFolderId:config.inboxFolderId,nativeHost:"capital.manuel.screenity_library"},null,2)+"\n",{mode:0o600});
const id = [...crypto.createHash("sha256").update(Buffer.from(config.extensionPublicKey,"base64")).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join("");
console.log(`Extension ID: ${id}`);
console.log("Build with npm run build:release, then load the build directory in Chrome.");
