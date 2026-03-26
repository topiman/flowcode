# FlowCode

基于本地 Claude Code CLI 的可视化 AI 驱动开发工具。

[English](./README.md)

## FlowCode 是什么

FlowCode 为本地 Claude Code CLI 提供可视化界面，用于编排 AI 驱动的开发工作流。工作流完全由你自定义——通过配置 **Agent** 和 **Skill** 来构建，没有固定流水线。每个团队都可以根据自己的开发流程定制工作流。

### 核心概念

- **Agent** — 专业化的 AI 角色（如架构师、开发工程师、代码审查员）。每个 Agent 有独立的 prompt、模型、输入输出文件和关联的 Skills。
- **Skill** — 可复用的知识模块，挂载到 Agent 上：编码规范、门禁检查、文档模板、参考资料等。
- **工作流模板** — 由一组 Agent 按顺序组成的开发流水线，可以创建任意多个。
## 架构

```
┌─────────────────────────────────────────┐
│           FlowCode (Web UI)             │
│        React 19 + Vite + Tailwind       │
├─────────────────────────────────────────┤
│          Express 5 API Server           │
│         SQLite (better-sqlite3)         │
├─────────────────────────────────────────┤
│        Claude Code CLI 进程池            │
│    持久化进程（最多 5 个，流式 JSON）      │
└─────────────────────────────────────────┘
```

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Claude Code CLI** 已安装并完成认证

### 安装

```bash
git clone <repo-url> && cd flowcode
npm install
npm run seed    # 初始化数据库（默认 Agent 和 Skills）
npm run dev     # 启动服务（http://localhost:4800）
```

## 使用

### 新建项目

1. 点击 **「新建项目」** 进入需求对话
2. AI 分析师通过问答收集需求
3. 确认后自动创建项目目录、git 仓库和工作流
4. 步骤自动执行，实时流式展示结果

### 迭代开发

1. 选择已有项目 → 选择模板 → 填写描述
2. 系统自动创建 git worktree 分支
3. 直接进入工作流执行（跳过对话阶段）

### 自定义工作流

**打造你自己的开发流程：**

1. **Agent 管理** — 添加/编辑 Agent，自定义 prompt、模型、输入输出文件
2. **Skill 管理** — 创建规范、模板、门禁检查或任意可复用的 prompt 模块
3. **关联 Skill 到 Agent** — 每个 Agent 可挂载多个 Skill（规范、门禁、模板等）
4. **工作流模板** — 用你的 Agent 定义步骤序列，组成流水线
5. **Skill 类型** — 用自定义分类和指令组织 Skills

## 功能特性

- **完全可定制** — 自定义 Agent、Skill 和工作流流水线
- **实时流式输出** — 实时查看 AI 思考过程、工具调用和输出
- **文件上传** — 对话中可粘贴图片或上传文本文件（.md、.json 等）
- **自动模式** — 连续执行步骤无需手动确认
- **会话持久化** — 中断后可从上次位置恢复
- **局域网访问** — 服务绑定 `0.0.0.0`，同网络其他机器可访问

## 目录结构

```
flowcode/
├── server/
│   ├── index.js            # Express 服务入口
│   ├── schema.sql          # 数据库表结构
│   ├── seed.js             # 数据库初始化
│   ├── seed-data.sql       # 默认 Skills 和 Agent-Skill 关联
│   ├── config.js           # 路径和端口配置
│   ├── routes/             # REST API 路由
│   └── services/
│       ├── claude-process.js    # Claude CLI 进程池
│       ├── workflow-executor.js # 步骤执行引擎
│       ├── prompt-builder.js    # 动态 Prompt 组装
│       ├── conversation.js      # 需求对话
│       └── sse.js               # Server-Sent Events
├── client/
│   └── src/
│       ├── pages/          # 项目列表、需求对话、工作流面板
│       ├── components/     # 流水线、聊天面板、日志查看器
│       └── hooks/          # useSSE 实时流式 Hook
├── projects/               # 生成的项目仓库
└── workflow.db             # SQLite 数据库（自动创建）
```

## 工作原理

1. **Prompt 组装** — Agent prompt 动态构建：基础 prompt + 内联输入文件 + 输出路径 + 关联 Skills（按 Skill 类型分组）。
2. **进程池** — 最多 5 个持久化 Claude CLI 进程，空闲超过 10 分钟自动回收。
3. **会话连续性** — 每个步骤存储 Claude CLI session ID，持久化在磁盘上，中断后可恢复。
## 许可

内部使用
