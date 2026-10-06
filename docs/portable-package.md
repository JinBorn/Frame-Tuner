# 通用资源包契约

网页「导出资源包」与 `node tools/frame_tuner.js export` 使用同一个浏览器画布合成器。PNG 序列和 Sheet + JSON 都附带 `manifest.json`；其他引擎可以读取该公开契约，不需要安装 Cocos、Godot、Unity 或 Agent。

```json
{
  "schema": "frame-tuner-package-v1",
  "version": 1,
  "projectId": "hero",
  "format": "sequence",
  "bakedVisual": true,
  "coordinateSystem": { "unit": "pixel", "x": "right", "y": "down" },
  "animations": [{
    "id": "hero/attack",
    "profileId": "hero",
    "name": "attack",
    "loop": false,
    "sourceFacesLeft": false,
    "frames": [{
      "sourceFrame": 0,
      "durationMs": 120,
      "timeMs": 0,
      "bakedSampleTimeMs": 60,
      "disabled": false,
      "path": "animations/001_hero_attack/frame_0001.png",
      "width": 256,
      "height": 256,
      "origin": { "x": 128, "y": 224 },
      "boxes": [{
        "kind": "hitbox",
        "enabled": true,
        "position": { "x": 40, "y": -80 },
        "size": { "x": 60, "y": 30 },
        "rotation": 15
      }],
      "audio": [{ "path": "audio/1_swing.wav", "volume": 0.5 }]
    }]
  }]
}
```

## 坐标与播放

- 所有资源路径相对于**包根目录**，包括 `source/project.json` 内重写的资源路径。
- 主体、变换、图片挂件和拖尾已经合成在 PNG 中。`source.transform`、`source.crop`、`source.boxes` 是追溯信息，播放时不要再次应用。
- `origin` 是角色原点在每张输出图中的像素位置。一个项目的所有动作使用相同输出尺寸和原点，切换帧不会因紧裁切而抖动。
- `durationMs` 可以是小数。`timeMs` 是帧开始时间；`bakedSampleTimeMs` 是用于采样视觉的时间，不应作为帧开始时间。网页导出每个启用的源帧一张图，禁用帧保留在可编辑源数据中。
- 框体中心 `position` 相对角色原点，已应用变换；大小是最终像素尺寸，`rotation` 是顺时针角度。`kind` 为 `hitbox`、`hurtbox` 或 `collisionbox`。接入 Y 向上的引擎时转换 Y 与角度方向即可；框体数据不自动安装游戏物理逻辑。
- 音效在进入对应输出帧时触发。`volume` 在 0–1 之间，文件位于包内。左右朝向由 `sourceFacesLeft` 表示烘焙素材朝向；消费者可以围绕原点镜像视觉与框体。

## 图集

Sheet 输出的帧 `path` 指向同一张 `spritesheet.png`，额外提供 `atlasRect: {x,y,width,height}`。先从图集中裁出这一矩形，再按 `origin` 放置。`source.crop` 是原始导入图集的裁切信息，和输出的 `atlasRect` 是两个不同层次。

每个动作另附常见的 `spritesheet.json`（`frames` 字典、`meta.image`、帧矩形、时长、`meta.origin`），便于使用已有图集导入器。其中 `audio.files` 的路径相对于该 JSON，`audio.events` 记录输出帧索引与音量。完整的框体与原始信息仍以包根 `manifest.json` 为准。

重新导入已解压的 Sheet 时，统一 CLI 会一并读取 JSON 引用的相邻音频并恢复原点、时长与音效。网页只选择 PNG + JSON、没有提供引用的音频文件时会明确拒绝导入，避免静默丢掉声音。图集是已烘焙资源，重新导入不会自动拆回原来的挂件和拖尾；继续无损编辑应使用原工作台项目。

## 可编辑源与导出限制

`source/project.json` 保存磁盘项目的 manifest、调参、音效、挂件、拖尾和画布设置；`source/editor-snapshot.json` 另外保留导出当时尚未保存的编辑状态。引用的素材复制到 `source/assets/`，按内容哈希命名。导出不保存或更改工作台项目，继续编辑仍以工作台项目为准；首期没有从 Cocos 反向合并的能力。

Cocos 导出将运行资源放入 `assets/`，同时在 `frame-tuner-source/` 保留完整通用资源包。不要将该备份目录复制到游戏的 `assets/` 中。

ZIP 解压后总大小限制为 256 MiB；单帧最大 8192×8192，单张 Sheet 每边最大 16384 且不超过 1.2 亿像素。导出会明确报错，避免裁掉超出画布的内容。浏览器下载 ZIP 不依赖目录选择器；旧 Lite 的逐文件目录导出保留在兼容面板中。

命令行导出需要 `npm install` 安装 `playwright-core`，以及本机 Chrome、Edge 或 Chromium。可用 `--browser` 或 `FRAME_TUNER_BROWSER` 指定浏览器；新建、导入、校验命令不需要浏览器。
