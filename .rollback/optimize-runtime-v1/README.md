# Runtime optimize v1 — 回滚 / 清理说明

分支：`optimize/runtime-v1`  
基线提交（改动前）：见 `BASE_COMMIT.txt`

## 改了什么（默认行为）

- 同时最多 **3** 个 live Agent（`PI_WEB_MAX_LIVE`，`0`=不限制）
- 空闲 **3 分钟**回收（`PI_WEB_IDLE_MS`）；正在 streaming/跑 tool 不会被 idle 杀掉
- SSE **不再**仅因连上就创建 Agent；只读浏览更轻
- 前端首屏消息 **80** 条 + 会话详情缓存 LRU 15
- destroy 时调用 `AgentSession.dispose()`，减少泄漏与跨会话脏状态

## 不改代码的「软回滚」（体验不好时先试）

在启动环境里加：

```bash
export PI_WEB_SSE_AUTOSTART=1   # SSE 连接时自动拉起 Agent（旧行为）
export PI_WEB_MAX_LIVE=0        # 不限制并发 live
export PI_WEB_IDLE_MS=600000    # 10 分钟 idle（旧约 10min）
```

然后重启 pi-web。

## 硬回滚（整段代码退回基线）

```bash
cd /Users/penghongxuan/ZCodeProject/pi-web
git checkout main
git branch -D optimize/runtime-v1   # 可选：删掉优化分支
# 若已在优化分支上提交且 main 未动：
# git reset --hard $(cat .rollback/optimize-runtime-v1/BASE_COMMIT.txt)
```

然后重启 dev/server。

## 体验好之后：删干净备份

确认没问题后：

```bash
# 1) 合并分支到 main（若尚未合并）
git checkout main
git merge optimize/runtime-v1

# 2) 删除回滚目录与分支
rm -rf .rollback/optimize-runtime-v1
git branch -d optimize/runtime-v1

# 3) 提交清理（若 .rollback 曾被跟踪）
git add -A && git status
```

不要长期留着 `.rollback/` 与多余分支。
