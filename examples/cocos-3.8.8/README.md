# Cocos Creator 3.8.8 独立演示

从仓库根目录生成一个独立项目：

```sh
node tools/cocos_export.js --sample --demo --out .tmp/cocos-3.8.8-demo
```

在 Cocos Creator **3.8.8** 中打开生成的 `.tmp/cocos-3.8.8-demo` 目录，等待资源导入，打开 `assets/frame-tuner-demo/FrameTunerDemo.scene`，点击预览。它会自行创建 Canvas、摄像机、播放节点、控制按钮及框体显示，不依赖任何现有游戏项目。

样例包含 120 / 310 / 80 ms 三个有效帧、一个禁用帧、不同大小的攻击范围和逐帧声音。点击 Loop / Once 按钮可解除浏览器音频手势限制；左右箭头设置朝向，空格暂停，N 单次，L 循环，Tab 切换动作。单次结束保持末帧，`finish` 计数每次播放只增加一次。

演示完全由 `tools/cocos/sample_package.js`、`tools/cocos_export.js` 和 `tools/cocos/*.ts` 生成，生成目录中的 `library`、`temp`、`build` 等 Cocos 缓存无需提交。

使用实际工作台导出的通用 ZIP 时，先解压，再生成演示：

```sh
node tools/cocos_export.js --input /path/to/unpacked-package --demo --out /path/to/new-cocos-demo
```

接入已有游戏时去掉 `--demo`，只把生成的 `assets` 合并进游戏项目；不要用独立演示的 `package.json` 替换现有游戏配置。详细 API、坐标和验收说明见 [Cocos 适配文档](../../docs/cocos-3.8.8.md)。
