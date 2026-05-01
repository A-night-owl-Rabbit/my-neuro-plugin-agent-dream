# Agent Dream（梦系统）

**my-neuro** 生态下的 **live-2d 社区插件**：在深夜静默窗口内，让数字角色进入「仿生梦境」——结合 MemOS 记忆做语义涟漪与联想，生成第一人称意识流梦叙事；可选「梦中图书馆」好奇心检索；梦醒后可提取关键词、梦残像，并按重要度写入长期记忆或仅落盘为本地文本。梦中若触发记忆整理，相关删除/合并等操作走审批窗口，避免误伤重要记忆。

本仓库结构与用法参考同作者的 [洛基之影（loki-shadow）](https://github.com/A-night-owl-Rabbit/my-neuro-plugin-loki-shadow) 插件发布方式：单目录插件、根目录即插件文件、`plugin_config.json` 为**脱敏模板**。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| **静默入梦** | 可配置时间段、冷却、概率、静默分钟数等，避免活跃对话中突然入梦 |
| **晚安快速通道** | 检测晚安后延迟再进入犯困流程，便于与其他插件错峰 |
| **记忆涟漪引擎** | 从近期/中期/深层记忆抽样与语义联想，构造梦境输入 |
| **独立梦境 LLM** | 可配置单独的 API URL、Key、模型与温度，与主对话模型解耦 |
| **本地梦日志** | 叙事与图书馆记录写入可配置目录（模板默认为相对路径 `./exported-dreams`） |
| **梦中图书馆** | 可选 `dream_curiosity_search`，依赖已配置好的搜索类插件（如 kimi-search） |
| **梦后处理** | 关键词、重要度、梦残像；达标写入 MemOS，低分仅本地文件 |
| **入梦气泡 UI** | 气泡位置与缩放可在配置中调节 |

---

## 环境要求

- 与 **my-neuro** `live-2d` 一致的 **Node.js** 运行环境  
- 已启用并正确配置 **MemOS**（记忆检索与写入依赖主程序与 MemOS 服务）  
- 若启用梦中检索：需 **kimi-search**（或兼容协议）等插件与对应 Key  

---

## 安装方式

将整个插件目录放到 my-neuro 的社区插件路径下，例如：

```text
live-2d/plugins/community/agent-dream/
```

目录内应包含 `index.js`、`metadata.json`、`plugin_config.json` 以及本仓库中的各模块文件。

在 my-neuro 中启用插件后，按界面提示重启或重新加载插件。

---

## 配置说明（`plugin_config.json`）

**本仓库中的 `plugin_config.json` 为公开模板：`dream_api_key` 等敏感项为空，梦境人设为占位说明，请勿把填好真实 Key 或私人角色设定的文件提交到 Git。**

### 主要配置项（节选）

| 配置项 | 说明 |
|--------|------|
| `dream_system_prompt` | 梦境专用系统提示词，需自行填写角色与叙事规则 |
| `drowsy_prompt` / `wakeup_prompt_template` / `interrupted_prompt` | 犯困、醒来梦话、被打断时的系统侧引导 |
| `dream_api_url` / `dream_api_key` / `dream_model` | 梦境 LLM；Key 留空时可回退主对话 Key（视主程序行为而定） |
| `dream_save_folder` | 梦境 txt 保存目录，建议使用你有写权限的路径 |
| `time_window_*` / `dream_frequency_hours` / `probability` | 做梦时段与触发节奏 |
| `silence_threshold_minutes` | 用户无交互多久后才允许入梦（重要安全阀） |
| `enable_dream_curiosity` | 是否启用梦中图书馆工具链 |
| `auto_save_to_memos` / `dream_importance_threshold` | 梦后是否写入 MemOS 及阈值 |

### 编辑 JSON 时的编码

若保存为 UTF-8 带 BOM，可能导致主程序解析报错。建议使用 VS Code 等保存为 **UTF-8（无 BOM）**。

---

## 仓库结构

| 文件 | 说明 |
|------|------|
| `index.js` | 插件入口、工具注册、与主模型/语音通道协作 |
| `dream-scheduler.js` | 做梦时机与状态机 |
| `sleep-transition.js` | 入睡/唤醒过渡 |
| `dream-wave-engine.js` | 记忆涟漪与联想 |
| `dream-operations.js` | 梦中记忆操作与审批联动 |
| `dream-store.js` | 本地 txt 与 `dream_logs/` JSON |
| `memos-adapter.js` | MemOS HTTP 适配 |
| `dreampost.txt` | 梦境用户消息模板片段 |
| `approval-window.html` / `approval-window.js` | 审批弹窗 |
| `metadata.json` | 插件元数据 |
| `plugin_config.json` | 配置模板（无真实密钥、无私有人设） |

---

## 隐私与开源注意

- 梦境叙事与记忆内容可能包含**个人生活信息**，请勿将运行产生的 `exported-dreams/`、`dream_logs/` 等目录提交到公开仓库。  
- 角色人设、系统提示词属于**可自行选择是否公开**的内容；本仓库仅提供结构与占位文案。  

---

## 许可证

若未另行声明，建议与主项目或社区惯例保持一致；你可以在 fork 后于本文件补充具体许可证名称与全文链接。

---

## 版本说明（本公开快照）

- 已对 `plugin_config.json` 做**脱敏**：清除 API Key、清除本机绝对路径、用人设占位文案替换原作者私人角色设定。  
- 已对源码中默认路径与检索用词做**泛化**，避免泄露个人目录或固定角色昵称。  
- `dream_state.json` 已重置为模板状态。  

若你基于本仓库二次开发，请继续遵守「不把真实 Key 与私人梦境文本推送到远程」的原则。
