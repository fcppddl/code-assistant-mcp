#!/usr/bin/env node

import { CodeAssistantMcpServer } from "./server.js";
import { config } from "dotenv";

config();

export async function startServer(): Promise<void> {
  const argvPort = process.argv
    .find((arg) => arg.startsWith("--port="))
    ?.split("=")[1];

  const port = argvPort
    ? Number(argvPort)
    : parseInt(process.env.PORT || "7777", 10);

  const isStdioMode = process.argv.includes("--stdio");

  // 创建服务器实例
  const server = new CodeAssistantMcpServer();

  try {
    // 启动HTTP服务器
    if (isStdioMode) {
      console.log("Initializing  MCP Server in STDIO mode...");
      server.startStdio();
    } else {
      console.log(`Initializing  MCP Server in HTTP mode on port ${port}...`);
      await server.startHttp(port);
    }
  } catch (error) {
    console.error("服务器启动失败:", error);
    process.exit(1);
  }
}

// If we're being executed directly (not imported), start the server
if (process.argv[1]) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
