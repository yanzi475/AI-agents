type AgentEvent =
  | { type: "task.start"; payload: { taskYamlPath: string } }
  | { type: "task.baseline_loaded"; payload: { baseline: any } }
  | { type: "task.context_merged"; payload: { mergedRules: any } }
  | { type: "task.quota_check"; payload: { quotaResult: QuotaResult } }
  | { type: "task.pause"; payload: { reason: string; quotaResult: QuotaResult } }
  | { type: "task.resume"; payload: {} }
  | { type: "task.test_run"; payload: { testResult: TestResult } }
  | { type: "task.complete"; payload: { summary: string; testResult: TestResult } }
  | { type: "task.fail"; payload: { reason: string } };

interface QuotaResult {
  changedFileCount: number;
  threshold: number;
  shouldPause: boolean;
  files: Array<{ path: string; op: string }>;
}

interface TestResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  cmd: string;
}
