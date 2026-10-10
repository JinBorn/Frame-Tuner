# Agent 接入

Frame Tuner 的 Agent 接口是本地 Node CLI 与同一份 `SKILL.md`。它不调用模型 API，不需要 Codex 账户，也不改变客户端的模型、密钥或全局指令。先安装工作台依赖：

```sh
git clone https://github.com/JinBorn/Frame-Tuner.git
cd Frame-Tuner
npm install
```

要求 Node.js 20.9+。导入和校验只用 Node；CLI 图片合成导出还需要本机 Chrome、Edge 或 Chromium，由 `playwright-core` 在独立无头会话中启动，不需要 Agent 操作网页或系统目录选择器。PNG 压缩依赖 `sharp`，与其他依赖一起通过 `npm install` 安装；导出时可选 `--png-quality 1..100`，默认 100 无损，源图不变。

## 选择安装位置

在工作台根目录运行安装器，明确选择客户端。默认是项目级安装；`--project-root` 是 **使用该 skill 的游戏/素材项目目录**，不是必须为工作台目录。

| 客户端 | `--client` | 项目级目录 | 用户级目录 |
|---|---|---|---|
| Codex | `codex` | `.agents/skills/xsxb-frame-tuner/` | `~/.agents/skills/xsxb-frame-tuner/` |
| Claude Code | `claude-code` | `.claude/skills/xsxb-frame-tuner/` | `~/.claude/skills/xsxb-frame-tuner/` |
| Cursor | `cursor` | `.cursor/skills/xsxb-frame-tuner/` | `~/.cursor/skills/xsxb-frame-tuner/` |
| DeepSeek Harness | `deepseek-harness` | `.dsh/skills/xsxb-frame-tuner/` | `$DSH_HOME/skills/xsxb-frame-tuner/` 或 `~/.dsh/skills/xsxb-frame-tuner/` |

例如先查看计划，再复制到指定项目：

```sh
node tools/install_skill.js --client codex --project-root "D:/Games/MyGame" --dry-run
node tools/install_skill.js --client codex --project-root "D:/Games/MyGame"
node tools/install_skill.js --client claude-code --project-root "D:/Games/MyGame"
node tools/install_skill.js --client cursor --project-root "D:/Games/MyGame"
node tools/install_skill.js --client deepseek-harness --project-root "D:/Games/MyGame"
```

按需选择其中一个命令即可。多个客户端也可能发现共享的 `.agents/skills`，重复安装同名 skill 可能形成多个候选项；安装器不会替你修改其他位置。

用户级安装须显式使用 `--scope user`：

```sh
node tools/install_skill.js --client deepseek-harness --scope user
```

自定义配置、旧版客户端或其他 Agent 使用 `--target`。它是 **完整 skill 目录**，安装器不会再追加名字：

```sh
node tools/install_skill.js --client generic --target "D:/AgentResources/skills/xsxb-frame-tuner"
```

将该目录加入客户端自己的 skill 搜索路径，或让 Agent 读取其中的 `SKILL.md` 后执行 CLI。安装器不自动改写 `AGENTS.md`、`CLAUDE.md`、Cursor rules、DeepSeek 配置、模型设置或凭据。`agents/openai.yaml` 只是 Codex 展示元数据，不是通用运行依赖。

## 更新与保护已有内容

安装器只复制这个 skill，记录各文件哈希。重复安装相同版本不会改动文件。升级由安装器创建且没有本地修改的旧副本时，明确加 `--replace`：

```sh
node tools/install_skill.js --client cursor --project-root "D:/Games/MyGame" --replace
```

已有目录没有安装记录、存在手动修改/额外文件或本身为符号链接时，安装器会停止并保留原内容。使用新的 `--target` 或自行合并现有指令；`--replace` 不会绕过这个保护。工作台的“更新并重启”只更新工具仓库，不安装或替换任何客户端 skill。

## 调用与交付边界

Codex 可以用 `$xsxb-frame-tuner`；Claude Code 可以用 `/xsxb-frame-tuner`。Cursor 和 DeepSeek Harness 可在当前版本的 skill 列表中选择，或直接说“使用 xsxb-frame-tuner”。不支持自动发现的 Agent 可以直接读取 skill 文件。

建议首次请求同时给出工作台路径、源素材路径和结果类型：

```text
使用 xsxb-frame-tuner。工具在 E:/Tools/Frame-Tuner。
把 D:/Art/Hero/idle 和 D:/Art/Hero/run 导入为 hero 的两个动作，12 FPS。
验证后导出 Cocos Creator 3.8.8 素材与播放器包到 D:/Exports/Hero，暂不接入游戏场景。
```

共享 CLI：

```sh
node tools/frame_tuner.js list
node tools/frame_tuner.js create --name "Hero" --id hero
node tools/frame_tuner.js import --project hero --input "D:/Art/Hero/idle" --profile hero --animation idle --fps 12
node tools/frame_tuner.js import --project hero --input "D:/Art/Hero/run.png" --json "D:/Art/Hero/run.json" --profile hero --animation run
node tools/frame_tuner.js validate --project hero
node tools/frame_tuner.js export --project hero --format cocos --out "D:/Exports/Hero"
```

`export --format` 支持 `sequence`、`sheet`、`cocos`；加 `--zip` 时 `--out` 是 ZIP 文件路径。自动找不到浏览器时用 `--browser "<浏览器可执行文件>"` 或环境变量 `FRAME_TUNER_BROWSER`。`FRAME_TUNER_ROOT` 可选择独立数据根目录；常规使用无需设置。

导入不自动修改游戏，Cocos 导出不自动添加碰撞器或更改战斗代码。只有明确要求运行时/游戏接线时，Agent 才使用相应引擎合同。执行结果应区分数据校验、图片产物检查、Creator/其他引擎编译、实际播放和 gameplay 验证。

## 官方依据与测试范围

安装目录依据以下官方文档/源码核对于 2026-10-06：

- [OpenAI Codex Skills](https://developers.openai.com/codex/skills/)：当前仓库级和用户级路径为 `.agents/skills`；自定义或旧配置可使用显式 `--target`。
- [Claude Code Skills](https://code.claude.com/docs/en/skills)：`.claude/skills`，目录中的 `SKILL.md` 支持直接调用。
- [Cursor Skills](https://cursor.com/docs/context/skills)：支持 `.cursor/skills` 和 `.agents/skills`；本地用户级 skill 不会自动传给所有远程/云端 Agent。
- [DeepSeek Harness Skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)：项目 `.dsh/skills`、`.agents/skills`、用户和自定义 provider 目录。
- [DeepSeek filesystem provider 源码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/src/index.ts)：默认 `DSH_HOME`/`~/.dsh`，以及共享的 `DSH_AGENTS_HOME`/`~/.agents`。需要启用 filesystem skill provider 与读文件/终端能力的 Agent 配置。

本次验证覆盖安装器的四种路径映射、显式目标、模拟安装/升级、重复执行、修改保护、链接拒绝和 JSON/退出码，均在临时目录执行。没有修改真实个人客户端配置，也没有向任何模型 API 发送测试请求。目录兼容性有官方依据；这不等于已实测每个客户端的模型自主完成整条导入/导出链路。
