# 备份、迁移与恢复

默认中立项目和旧 Lite 项目可直接复制本地目录备份，无需安装额外工具。备份前先在网页保存，确认保存及音效同步成功，再停止工作台服务。

## 需要保留什么

从数据根目录完整复制以下目录到一个新的备份文件夹。数据根默认是仓库目录；设置过 `FRAME_TUNER_ROOT` 时，以该路径为准。

| 目录 | 内容 |
| --- | --- |
| `data/` | 项目列表、动画数据、调参、音效绑定、挂件、拖尾、共享预设与设置，含旧 Lite 数据。 |
| `workspace/` | 导入的帧图、音效、挂件和自定义拖尾纹理，含旧 Lite 素材。 |
| `audio/`（如果存在） | 部分历史项目引用的音效；遗漏会导致音效丢失或导出失败。 |

同时在代码仓库运行 `git rev-parse HEAD`，把输出的版本号记录在备份旁。Git 提交不能代替项目备份，本地项目数据大部分由 Git 忽略。

## 恢复到新目录

1. 使用备份时的工具版本并安装依赖（`npm install`）。
2. 创建一个空的数据根，例如 `D:\FrameTunerData`，把备份的三个目录放入其中，使其直接包含 `data`、`workspace` 和可能存在的 `audio`。不要合并两个工作台的项目列表，也不要覆盖正在使用的数据根。
3. 在工具代码目录打开 PowerShell，指定恢复的数据根并校验项目：

   ```powershell
   $env:FRAME_TUNER_ROOT = 'D:\FrameTunerData'
   node tools/frame_tuner.js list
   node tools/frame_tuner.js validate --project 你的项目ID
   npm start
   ```

4. 打开 `http://127.0.0.1:5179`，检查帧图、时长、调参和音效，再导出一次，确认资源完整后开始编辑。迁移验收时可让原始素材目录暂时不可用，确保恢复结果不依赖旧路径或浏览器缓存。

旧 Lite 项目仍从 `data/lite/projects.json` 读取，主工作台的 `list` 不会列出它们。在同一个已设置环境变量的终端改用：

```powershell
node tools/frame_tuner_lite/validate.js --project 你的Lite项目ID
npm run start:lite
```

打开 `http://127.0.0.1:5180` 检查。`FRAME_TUNER_ROOT` 只作用于当前终端及其启动的进程；以后启动时仍需设置，双击启动脚本不会继承另一个终端的设置。

## 范围

- 上述步骤适用于默认目录布局。手工配置过 `dataDir`／`workspaceDir`，或绑定 Godot、Unity、Codex Pets 外部目录的项目，还需单独保留被引用的目录，并检查恢复后的绑定路径。
- 导出的运行包虽包含源素材和编辑快照，目前不能作为完整项目备份直接导入恢复；应保留上述数据目录。
- 未保存的网页修改、尚未同步成功的音效不在磁盘备份中。浏览器主题等界面偏好不属于项目数据。

Windows 隔离迁移、原目录离线后的校验和实际导出已验证，详见[验收记录](verification-2026-10-06.md)。
