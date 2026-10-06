# Cocos Creator 3.8.8 适配

工作台导出透明 PNG 序列或烘焙图集，Cocos 播放组件消费这些图像及独立的时序、框体、音效数据。人物变换、图片挂件和攻击拖尾已经合成在图像中，不在 Cocos 再套用一次。工作台仍是编辑依据，导出文件可以重新生成；游戏业务代码放在生成目录之外。

## 导出与接入

网页选择 Cocos 导出后解压，将 `assets` 目录合并进 Cocos Creator **3.8.8** 项目。统一命令行可使用 `node tools/frame_tuner.js export --project PROJECT_ID --format cocos --out OUTPUT_DIRECTORY`；`node tools/frame_tuner.js help` 提供完整参数。

已有通用包时，可以独立运行转换工具：

```sh
node tools/cocos_export.js --input /path/to/unpacked-neutral-package --out /path/to/new-output
```

结构如下：

```text
assets/
  resources/frame-tuner/<resourceId>/
    manifest.json
    ...透明 PNG 与音效
  scripts/frame-tuner/
    FrameTunerPlayer.ts
    FrameTunerClock.ts
    FrameTunerData.ts
FRAME-TUNER-IMPORT.json
FRAME-TUNER-README.md
frame-tuner-source/
  manifest.json
  source/project.json
  source/assets/...
  ...完整通用包
```

`resourceId` 通常等于项目 ID；包含中文或其他不适合资源路径的 ID 会映射为 `project-<hash>`，原项目 ID 保留在数据内。**使用 `FRAME-TUNER-IMPORT.json` 的 `resourcePath`**，无需猜测目录名称。运行资源中的 `sourceArchive` 相对于导出包根目录；`frame-tuner-source/manifest.json` 保留原通用包及其 `editableSource` 引用，原素材、图集裁切信息及可编辑项目快照不会被烘焙结果取代。

将 `FrameTunerPlayer` 挂在 Canvas 下的角色节点。属性 `packagePath` 填上述 `resourcePath`，不加 `.json`。`autoPlay` 默认自动加载并播放第一个动作；从游戏代码管理时关闭它：

```ts
import { _decorator, Component } from 'cc';
import { FrameTunerPlayer } from './frame-tuner/FrameTunerPlayer';
const { ccclass } = _decorator;

@ccclass('ActorAnimation')
export class ActorAnimation extends Component {
    async start() {
        const player = this.node.getComponent(FrameTunerPlayer)!;
        // 在编辑器中关闭 player.autoPlay，避免自动流程先于此 start 执行。
        this.node.on('frame-tuner-finished', ({ animationId }) => {
            console.log('Action finished', animationId);
        });
        try {
            await player.load('frame-tuner/demo/manifest');
            player.setFacingLeft(false);
            player.play('demo/punch', false);
        } catch (error) {
            console.error('Cannot load animation package', error);
        }
    }
}
```

新目录导出默认拒绝覆盖。独立工具的 `--overwrite` 只用于自己管理的生成目录，更新已生成文件，不删除其他文件；它不是同步或清理现有游戏项目的命令。

## 播放与事件

| 接口 | 行为 |
| --- | --- |
| `load(resourcePath)` | 预载 JSON、图像与音效；失败时 Promise 拒绝。再次加载使旧异步结果失效。 |
| `play(animationId?, loop?)` | 从第一个有效帧开始；省略动作使用第一个动作，省略 loop 使用包内设置。全禁用动作返回 `false`。 |
| `pause()` / `resume()` | 保留当前帧内余量，恢复时不重新触发该帧事件。 |
| `stop()` | 停止推进，保留当前可见帧。 |
| `setFacingLeft(boolean)` | 以导出包的 `sourceFacesLeft` 为基础镜像，图像与框体一致。 |
| `queryBoxes(kind?, world=false)` | 返回当前有效框体的四个角点，默认在播放器节点本地坐标；world=true 应用节点完整世界变换。 |
| `pixelsPerUnit` | 默认 1，与 UI 像素匹配；同时缩放图像和框体。 |
| `speed` / `mute` | 非负播放速率；静音只影响声音输出，不屏蔽逻辑音效事件。 |

`durationMs` 是各帧的实际毫秒数。播放时钟保存每次 `update` 的时间余量，跨越多个帧时依次发送逻辑事件；禁用帧不占时长、不发帧事件、不发声。单次播放结束保留最后一个有效帧，每次 `play` 只产生一次结束事件。

| 节点事件 | 载荷 |
| --- | --- |
| `frame-tuner-ready` | 完整运行包 |
| `frame-tuner-frame` | `{ animationId, frame }` |
| `frame-tuner-audio` | `{ animationId, sourceFrame, audio }` |
| `frame-tuner-loop` | `{ animationId, cycles }` |
| `frame-tuner-finished` | `{ animationId }` |
| `frame-tuner-error` | 自动加载发生的 Error；手动 `load` 应使用 catch。 |

浏览器通常需要点击或按键后才允许声音。慢帧跨过多个动画帧时，框体/音效逻辑事件仍按顺序到达，但**只播放最终可见帧的音效**，避免补播过期声音形成爆音。这与工作台的实际声音策略一致。`frame-tuner-audio` 表示逻辑音效事件，不等同于设备确实播放了声音。

## 坐标、原点和图集

通用包采用像素坐标：X 向右、Y 向下。`frame.origin` 是最终 PNG（或烘焙图集的局部帧）中的原点。播放器设置 UI 锚点为 `(origin.x / width, 1 - origin.y / height)`；不同帧尺寸也围绕同一角色原点对齐，不会以每张 PNG 的中心重新定位。

框体的 `position` 是相对角色原点的中心，`size` 是完整宽高，`rotation` 是 Y 向下坐标中的顺时针角度。导出端已计算工作台变换。播放器把角点的 Y 取反，并按朝向镜像 X；`queryBoxes(..., true)` 继续应用玩家节点的世界变换。它返回有向四边形，不假装返回轴对齐包围盒，也不自动安装物理碰撞器。

可选 `atlasRect: { x, y, width, height }` 表示**最终烘焙图集**中的矩形，按贴图左上角像素裁切；禁止旋转矩形，尺寸必须匹配帧宽高且不能越界。原始素材的 `sourceCrop` 等字段仅供追溯，已在烘焙阶段处理，不在引擎里二次裁切。图片只支持 PNG，音频支持 WAV / MP3 / OGG；未知包版本、无效路径、缺失资源及不一致尺寸会报错。

## 独立演示与验证

```sh
node tools/cocos_export.js --sample --demo --out .tmp/cocos-3.8.8-demo
node tools/cocos/self_test.js
node tools/cocos/typecheck.js --engine "C:/ProgramData/cocos/editors/Creator/3.8.8/resources/resources/3d/engine"
```

以独立项目打开 `.tmp/cocos-3.8.8-demo`，再打开 `assets/frame-tuner-demo/FrameTunerDemo.scene`，等待导入完成后点击预览。演示脚本自行建立 Canvas、摄像机、角色、框体显示和控制按钮。示例有 120 / 310 / 80 ms 三个有效帧及一个禁用帧，验证暂停、左右朝向、循环、单次结束事件和逐帧音效。点击 Loop / Once 解锁浏览器音频。`--input <通用包目录> --demo` 可以用实际工作台产物生成相同演示。

自动化自测执行真实的纯 TypeScript 播放时钟和几何函数，覆盖非等时长、长时间累加、跨帧、禁用、重入播放、循环中暂停、单次完成、锚点、旋转镜像、图集边界、原始项目归档和非法数据。API 类型检查使用本机 Creator 3.8.8 自带的真实 `cc.d.ts`；缺少引擎时明确失败，不用伪造声明冒充通过。两者均不替代引擎场景运行验收。

2026-10-06 已使用 Windows 上的 **Creator 3.8.8 实际构建 Web Desktop**，并在 Chrome 加载构建产物完成资源加载、不等时长、禁用帧、单次结束、循环／暂停、镜像框体与音效事件检查。最近一次测得前两帧间隔 125 / 320 ms（目标 120 / 310 ms；浏览器按显示帧调度）。验证包括点击解锁音频、音频资源加载与逻辑事件，没有进行声学录音比对。详见 [验收记录](verification-2026-10-06.md)。

复跑引擎浏览器验收：先在 Creator 构建独立演示为 Web Desktop，以 `FrameTunerDemo.scene` 为启动场景，用任意静态服务器托管构建目录，再运行：

```sh
# 可选静态服务器示例，需要 Python；它不是工作台运行依赖。
python -m http.server 5189 --bind 127.0.0.1 --directory .tmp/cocos-3.8.8-demo/build/web-desktop
# 在另一个终端执行；其他地址可通过 --url 指定。
npm run test:cocos:browser -- --url http://127.0.0.1:5189
```

此浏览器测试依赖独立演示提供的诊断接口，只适用于按上面步骤生成的演示，不注入到游戏运行组件中。

本适配面向 Cocos Creator 3.8.8 的 2D Canvas/Sprite 工作流；游戏碰撞响应、战斗状态机、动画事件的业务行为和生成文件反向合并由项目自行管理。其他引擎可以消费通用包，不能据此宣称已经具有自动接入适配器。
