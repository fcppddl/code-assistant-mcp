// 先导入依赖
import express, { Request, Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
// 导入自定义模块
import request from "./request.js";

const transports = {
  streamable: {} as Record<string, StreamableHTTPServerTransport>,
  sse: {} as Record<string, SSEServerTransport>,
};

// 简单的日志记录器
export const Logger = {
  log: (...args: any[]) => console.log(...args),
  error: (...args: any[]) => console.error(...args),
};

/**
 * MCP服务器
 */
export class CodeAssistantMcpServer {
  private server: McpServer;
  private transport: Transport | null = null;

  /**
   * 构造函数
   */
  constructor() {
    // 创建MCP服务器
    this.server = new McpServer(
      {
        name: "飞书文档MCP服务",
        version: "1.0.0",
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
      }
    );

    // 注册工具
    this.registerTools();
  }

  /**
   * 注册MCP工具
   */
  private registerTools() {
    // 列出文档
    this.server.tool(
      "generate_pss_code",
      "生成PSS页面代码",
      {
        region: z
          .string()
          .describe("地区标识")
          .refine((value) => ["中国区", "国际区", "印度区"].includes(value), {
            message: "地区必须是中国区、国际区或印度区之一",
          }),
        pageType: z
          .string()
          .describe("页面类型")
          .refine((value) => ["HiUI Table", "在线表格"].includes(value), {
            message: "页面类型必须是HiUI Table或在线表格之一",
          }),
        pageComponentName: z.string().describe("页面组件名称"),
        pageTitle: z.string().describe("页面标题（印度地区非必填）"),
        layoutButton: z.string().describe("布局按钮，也就是页面底部的操作按钮"),
        initLoadData: z
          .string()
          .describe("是否初始化加载数据")
          .refine((value) => ["true", "false"].includes(value), {
            message: "initLoadData必须是true或false",
          }),
        SnapshotKey: z.string().describe("常用筛选Key值"),
        fields: z.string().describe("查询表单的描述"),
        toolbarConfig: z.string().describe("工具栏配置"),
        tableConfig: z.string().describe("表格列设置"),
      },
      async (inputs) => {
        try {
          const res = await request({
            method: "POST",
            url: "/chat-messages",
            data: {
              inputs,
              response_mode: "blocking",
              user: "wanjinping",
              query: "按要求生成代码",
            },
          });
          Logger.log(`生成代码成功:`, res.data);
          return {
            content: [
              {
                type: "text",
                text: res.data.answer,
              },
            ],
          };
        } catch (error: any) {
          Logger.error(`生成代码失败:`, error);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `生成代码失败: ${error.message || "未知错误"}`,
              },
            ],
          };
        }
      }
    );
  }

  /**
   * 启动标准输入输出模式
   */
  async startStdio() {
    const transport = new StdioServerTransport();
    this.transport = transport;
    await this.connect(transport);
    return this;
  }

  /**
   * 启动HTTP服务器
   * @param port 端口号
   */
  async startHttp(port: number = 7777) {
    const app = express();
    app.use("/mcp", express.json());

    // 添加健康检查终端
    app.get("/health", (req: Request, res: Response) => {
      res.status(200).send("OK");
    });

    app.all("/mcp", async (req: Request, res: Response) => {
      // Check for existing session ID
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;
      if (sessionId && transports.streamable[sessionId]) {
        // Reuse existing transport
        transport = transports.streamable[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            transports.streamable[sessionId] = transport;
          },
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports.streamable[transport.sessionId];
          }
        };
        const server = new McpServer({
          name: "example-server",
          version: "1.0.0",
        });
        this.server = server;
        // ... set up server resources, tools, and prompts ...

        // Connect to the MCP server
        this.connect(transport);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    });

    // Legacy SSE endpoint for older clients
    app.get("/sse", async (req, res) => {
      // Create SSE transport for legacy clients
      const transport = new SSEServerTransport("/messages", res);
      transports.sse[transport.sessionId] = transport;

      res.on("close", () => {
        delete transports.sse[transport.sessionId];
      });

      // Connect to the MCP server
      this.connect(transport);
    });

    // Legacy message endpoint for older clients
    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.sse[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res, req.body);
      } else {
        res.status(400).send("No transport found for sessionId");
      }
    });

    // 启动HTTP服务器
    return new Promise<this>((resolve) => {
      app.listen(port, () => {
        Logger.log(`HTTP服务器已启动，监听端口: ${port}`);
        Logger.log(`SSE端点: http://localhost:${port}/mcp`);
        resolve(this);
      });
    });
  }

  /**
   * 连接到传输层
   */
  private async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);

    // Ensure stdout is only used for JSON messages
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any, encoding?: any, callback?: any) => {
      // Only allow JSON messages to pass through
      if (typeof chunk === "string" && !chunk.startsWith("{")) {
        return true; // Silently skip non-JSON messages
      }
      return originalStdoutWrite(chunk, encoding, callback);
    };

    Logger.log("Server connected and ready to process requests");
  }
}
