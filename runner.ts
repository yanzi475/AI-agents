on("task.start", async (evt) => {
  // 1. MCP：读取基线
  const baseline = await mcp.call("read_project_baseline", {});
  emit("task.baseline_loaded", { baseline });

  // 2. MCP：合并任务上下文
  const merged = await mcp.call("load_task_context", { taskPath: evt.payload.taskYamlPath });
  emit("task.context_merged", { mergedRules: merged });

  // 3. 前置业务校验（例如目标目录是否在 no_touch）
  if (merged.no_touch?.includes(merged.target_module)) {
    emit("task.fail", { reason: "目标模块在全局禁止修改列表" });
    return;
  }

  // 4. 进入编码循环
  while (!done) {
    // Agent 生成代码、写入文件
    await agent.act();

    // MCP：检查变更配额
    const quota = await mcp.call("check_change_quota", { diffFilter: ["A", "M"] });
    emit("task.quota_check", { quotaResult: quota });

    if (quota.shouldPause) {
      emit("task.pause", { reason: "变更文件达到阈值", quotaResult: quota });
      await waitEvent("task.resume"); // 阻塞等待人工确认
    }
  }

  // 5. 全部修改完成，跑回归
  const testResult = await mcp.call("run_regression_test", {});
  emit("task.test_run", { testResult });

  if (testResult.ok) {
    emit("task.complete", { summary: "重构完成", testResult });
  } else {
    emit("task.fail", { reason: "回归测试不通过" });
  }
});
