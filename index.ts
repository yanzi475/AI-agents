import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import simpleGit from "simple-git";
import { execa } from "execa";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const BASELINE_PATH = path.join(REPO_ROOT, ".agent/project-baseline.yaml");

const git = simpleGit(REPO_ROOT);

const server = new Server(
  { name: "repo-context-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ========== Schema ==========
const ReadBaselineArgs = z.object({});
const LoadTaskArgs = z.object({
  taskPath: z.string().describe("任务yaml路径，如 .agent/tasks/task-billing-refactor.yaml"),
});
const CheckQuotaArgs = z.object({
  diffFilter: z.array(z.string()).optional().default(["A", "M"]),
});
const RunTestArgs = z.object({
  testCmd: z.string().optional(),
});

// ========== 工具列表声明 ==========
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_project_baseline",
        description: "读取仓库全局项目基线 .agent/project-baseline.yaml，返回通用规则",
        inputSchema: ReadBaselineArgs,
      },
      {
        name: "load_task_context",
        description: "加载单次任务上下文，与基线合并，task配置优先级高于基线",
        inputSchema: LoadTaskArgs,
      },
      {
        name: "check_change_quota",
        description: "统计git变更文件数量，对比基线阈值，超限返回should_pause=true",
        inputSchema: CheckQuotaArgs,
      },
      {
        name: "run_regression_test",
        description: "执行回归测试命令，捕获stdout/stderr，返回结构化测试结果",
        inputSchema: RunTestArgs,
      },
    ],
  };
});

// ========== 工具实现 ==========
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  switch (name) {
    case "read_project_baseline": {
      try {
        const raw = await fs.readFile(BASELINE_PATH, "utf8");
        const baseline = yaml.parse(raw);
        return { content: [{ type: "text", text: JSON.stringify(baseline, null, 2) }] };
      } catch (err) {
        throw new McpError(ErrorCode.InternalError, `读取基线失败: ${(err as Error).message}`);
      }
    }

    case "load_task_context": {
      const parsed = LoadTaskArgs.parse(args);
      const taskFilePath = path.join(REPO_ROOT, parsed.taskPath);
      const [baselineRaw, taskRaw] = await Promise.all([
        fs.readFile(BASELINE_PATH, "utf8"),
        fs.readFile(taskFilePath, "utf8"),
      ]);
      const baseline = yaml.parse(baselineRaw);
      const task = yaml.parse(taskRaw);

      // 简单深度合并：task.override 覆盖顶层key，新增key直接追加
      const merged = { ...baseline, ...task.override, task_specific: task };
      return { content: [{ type: "text", text: JSON.stringify(merged, null, 2) }] };
    }

    case "check_change_quota": {
      const parsed = CheckQuotaArgs.parse(args);
      const baselineRaw = await fs.readFile(BASELINE_PATH, "utf8");
      const baseline = yaml.parse(baselineRaw);
      const threshold = baseline.guardrail?.max_change_files ?? 10;

      const diff = await git.diffSummary(["--cached"]);
      const changedFiles = diff.files.filter((f) =>
        parsed.diffFilter.includes(f.operation)
      );
      const count = changedFiles.length;
      const shouldPause = count >= threshold;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              changedFileCount: count,
              threshold,
              shouldPause,
              files: changedFiles.map((f) => ({ path: f.file, op: f.operation })),
              hint: shouldPause ? "已达到变更上限，暂停并等待确认" : "配额正常，可继续修改",
            }),
          },
        ],
      };
    }

    case "run_regression_test": {
      const parsed = RunTestArgs.parse(args);
      const baselineRaw = await fs.readFile(BASELINE_PATH, "utf8");
      const baseline = yaml.parse(baselineRaw);
      const cmd = parsed.testCmd ?? baseline.meta.tech.test;

      try {
        const { stdout, stderr, exitCode } = await execa(cmd, {
          shell: true,
          cwd: REPO_ROOT,
          reject: false,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: exitCode === 0,
                exitCode,
                stdout,
                stderr,
                cmd,
              }),
            },
          ],
        };
      } catch (err) {
        throw new McpError(ErrorCode.InternalError, `执行测试失败: ${(err as Error).message}`);
      }
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `未知工具 ${name}`);
  }
});

// 启动 stdio transport（MCP 标准）
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("repo-context-mcp running on stdio");
