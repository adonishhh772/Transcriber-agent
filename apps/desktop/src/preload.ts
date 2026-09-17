import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("env", {
  platform: process.platform
});