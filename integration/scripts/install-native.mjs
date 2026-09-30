import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(fs.readFileSync(path.join(root,"integration.config.local.json"),"utf8"));
if (!config.extensionPublicKey) throw new Error("Generate the extension public key first.");
for (const file of ["integration/worker/target/release/screenity-library", "integration/native/target/release/screenity-library-app"]) {
  fs.accessSync(path.join(root, file), fs.constants.X_OK);
}
if (!/^[A-Za-z0-9_-]+$/.test(config.rootFolderId)) throw new Error("Invalid library folder ID.");
const id = [...crypto.createHash("sha256").update(Buffer.from(config.extensionPublicKey,"base64")).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join("");
const installed = path.join(os.homedir(), "Library/Application Support/Screenity Library");
fs.mkdirSync(path.join(installed,"bin"),{recursive:true,mode:0o700});
fs.copyFileSync(path.join(root,"integration/worker/target/release/screenity-library"),path.join(installed,"bin/screenity-library"));
fs.chmodSync(path.join(installed,"bin/screenity-library"),0o700);
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const wrapper = path.join(installed,"native-host");
const env = config.typesafeEnvFile ? `export TYPESAFE_ENV_FILE=${quote(config.typesafeEnvFile)}\n` : "";
fs.writeFileSync(wrapper,`#!/bin/sh\nexport PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin\n${env}exec ${quote(path.join(installed,"bin/screenity-library"))} native-host\n`,{mode:0o700});
const hosts=path.join(os.homedir(),"Library/Application Support/Google/Chrome/NativeMessagingHosts");
fs.mkdirSync(hosts,{recursive:true});
fs.writeFileSync(path.join(hosts,"capital.manuel.screenity_library.json"),JSON.stringify({name:"capital.manuel.screenity_library",description:"Transcribe and classify Screenity recordings with Jev",path:wrapper,type:"stdio",allowed_origins:[`chrome-extension://${id}/`]},null,2)+"\n",{mode:0o600});
const app=path.join(os.homedir(),"Applications/Screenity Library.app");
fs.mkdirSync(path.join(app,"Contents/MacOS"),{recursive:true});
fs.mkdirSync(path.join(app,"Contents/Resources"),{recursive:true});
fs.copyFileSync(path.join(installed,"bin/screenity-library"),path.join(app,"Contents/Resources/screenity-library"));
fs.chmodSync(path.join(app,"Contents/Resources/screenity-library"),0o755);
fs.writeFileSync(path.join(app,"Contents/Info.plist"),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>ScreenityLibrary</string><key>CFBundleIdentifier</key><string>capital.manuel.screenity-library</string><key>CFBundleName</key><string>Screenity Library</string><key>ScreenityRootFolder</key><string>${config.rootFolderId}</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>`);
fs.writeFileSync(path.join(app,"Contents/Resources/library.json"),JSON.stringify({root_folder_id:config.rootFolderId})+"\n");
fs.copyFileSync(path.join(root,"integration/native/target/release/screenity-library-app"),path.join(app,"Contents/MacOS/ScreenityLibrary"));
fs.chmodSync(path.join(app,"Contents/MacOS/ScreenityLibrary"),0o755);
execFileSync("codesign",["--force","--deep","--sign","-",app],{stdio:"inherit"});
console.log(`Native library installed: ${app}`);
console.log(`Chrome native host registered for extension ${id}`);
