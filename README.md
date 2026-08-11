# Agent Dream（梦系统）

**my-neuro** 生态下的 **live-2d 社区插件**：在深夜静默窗口内，让数字角色进入「仿生梦境」——结合 MemOS 记忆做语义涟漪与联想，生成第一人称意识流梦叙事；可选「梦中图书馆」好奇心检索；梦醒后可提取关键词、梦残像，并按重要度写入长期记忆或仅落盘为本地文本。梦中若触发记忆整理，相关删除/合并等操作走审批窗口，避免误伤重要记忆。


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

```
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

## 想邀请你，做这只小牛的“云饲养员”

做这个桌宠的初衷，其实是因为自己一个人工作学习的时候，总觉得屏幕里空落落的。看到大家都在使用，我就觉得熬夜写代码、调教AI的日子都亮闪闪的。🌟

不过，肥牛现在还在长身体（其实是我想给它做更多有趣的插件），养一只数字小牛其实也挺“费草”的哈哈。🌱

如果你在这只小肥牛这里获得过哪怕一秒钟的治愈，或者觉得它算个合格的桌面搭子，要不要考虑成为它的“云饲养员”呀？

你的每一次充电，都不是在打赏我，而是在给这只肥牛注入一点点魔法值。让它能变得更聪明、更通人性、能听懂你更多的碎碎念。

不用有压力哦！你愿意打开它，就是对我最大的鼓励啦。如果刚好有余力，就请肥牛喝瓶快乐水叭，它会记住你的味道的！🥤❤️

爱发电 https://ifdian.net/a/0923A

---

## 许可证

本项目采用 **CC BY-NC-ND 4.0** 许可证。
