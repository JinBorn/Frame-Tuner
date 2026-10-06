import { _decorator, Camera, Canvas, Color, Component, EventKeyboard, Graphics, input,
    Input, KeyCode, Label, Layers, Node, UITransform, view, ResolutionPolicy } from 'cc';
import { FrameTunerPlayer } from './FrameTunerPlayer';
import { BakedFrame } from './FrameTunerData';
const { ccclass, property } = _decorator;

/** Independent scene: constructs its own canvas, camera and controls. */
@ccclass('FrameTunerDemo')
export class FrameTunerDemo extends Component {
    @property packagePath = 'frame-tuner/demo/manifest';
    private player: FrameTunerPlayer | null = null;
    private status: Label | null = null;
    private graphics: Graphics | null = null;
    private animationIndex = 0;
    private finishes = 0;
    private audioEvents = 0;
    private lastError = '';
    private diagnostics: object | null = null;
    private timeline: { sourceFrame: number; timestampMs: number }[] = [];

    onLoad(): void {
        view.setDesignResolutionSize(960, 640, ResolutionPolicy.SHOW_ALL);
        const canvasNode = this.uiNode('Canvas', this.node, 0, 0, 960, 640);
        canvasNode.setPosition(480, 320, 0);
        const canvas = canvasNode.addComponent(Canvas);
        const cameraNode = new Node('Camera');
        canvasNode.addChild(cameraNode);
        cameraNode.setPosition(0, 0, 1000);
        const camera = cameraNode.addComponent(Camera);
        camera.projection = Camera.ProjectionType.ORTHO;
        camera.orthoHeight = 320;
        camera.near = 0.1;
        camera.far = 2000;
        camera.visibility = Layers.Enum.UI_2D;
        camera.clearColor = new Color(14, 20, 32, 255);
        canvas.cameraComponent = camera;
        this.label(canvasNode, 'FRAME TUNER / COCOS 3.8.8', 0, 260, 28);
        this.label(canvasNode, 'Baked visuals · frame timing · facing · boxes · audio events', 0, 218, 17);
        const actor = this.uiNode('Actor', canvasNode, 0, -60, 1, 1);
        this.player = actor.addComponent(FrameTunerPlayer);
        this.player.autoPlay = false;
        this.player.packagePath = this.packagePath;
        const overlay = this.uiNode('Box overlay', actor, 0, 0, 1, 1);
        this.graphics = overlay.addComponent(Graphics);
        this.graphics.lineWidth = 2;
        actor.on('frame-tuner-finished', () => { this.finishes += 1; });
        actor.on('frame-tuner-audio', () => { this.audioEvents += 1; });
        actor.on('frame-tuner-frame', ({ frame }: { frame: BakedFrame }) => {
            this.timeline.push({ sourceFrame: frame.sourceFrame, timestampMs: Date.now() });
            if (this.timeline.length > 32) this.timeline.shift();
        });
        actor.on('frame-tuner-error', (error: Error) => { this.lastError = error.message; });
        // A read-only snapshot API for independent demo acceptance checks. It is
        // deliberately absent from FrameTunerPlayer and production resource packs.
        this.diagnostics = Object.freeze({ snapshot: () => ({
            ready: !!this.player?.data,
            projectId: this.player?.data?.projectId,
            animationId: this.player?.animation?.id,
            sourceFrame: this.player?.currentFrame?.sourceFrame,
            durationMs: this.player?.currentFrame?.durationMs,
            playing: this.player?.clock.playing,
            finished: this.player?.clock.finished,
            cycles: this.player?.clock.cycles,
            faceLeft: this.player?.faceLeft,
            finishEvents: this.finishes,
            audioEvents: this.audioEvents,
            error: this.lastError,
            boxes: this.player?.queryBoxes().map(box => ({ kind: box.kind, corners: box.corners.map(point => ({ x: point.x, y: point.y })) })),
            timeline: this.timeline.map(entry => ({ ...entry })),
        }) });
        (globalThis as typeof globalThis & { __frameTunerDemo?: object }).__frameTunerDemo = this.diagnostics;
        this.status = this.label(canvasNode, 'Loading package…', 0, -175, 18);
        this.button(canvasNode, 'Loop [L]', -320, () => this.play(true));
        this.button(canvasNode, 'Once [N]', -160, () => this.play(false));
        this.button(canvasNode, 'Pause [Space]', 0, () => this.togglePause());
        this.button(canvasNode, 'Mirror [← →]', 160, () => this.player?.setFacingLeft(!this.player.faceLeft));
        this.button(canvasNode, 'Next [Tab]', 320, () => this.next());
        this.label(canvasNode, 'Click Loop or Once to enable browser audio. Cyan = hurt · coral = hit · gold = collision', 0, -284, 14);
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        this.player.load(this.packagePath).then(() => {
            if (!this.isValid || !this.player?.data) return;
            const frames = this.player.data.animations.flatMap(animation => animation.frames);
            const maxWidth = Math.max(1, ...frames.map(frame => frame.width));
            const maxHeight = Math.max(1, ...frames.map(frame => frame.height));
            // Fit display only: the runtime itself defaults to one pixel per canvas unit.
            const fit = Math.min(2, 380 / maxWidth, 260 / maxHeight);
            this.player.node.setScale(fit, fit, 1);
            this.play(true);
            console.info('[Frame Tuner demo] ready', this.player.data.projectId, this.player.data.animations.length);
        }).catch(error => {
            this.lastError = String(error.message || error);
            console.error('[Frame Tuner demo]', error);
        });
    }

    private uiNode(name: string, parent: Node, x: number, y: number, width: number, height: number): Node {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        node.setPosition(x, y, 0);
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }

    private label(parent: Node, text: string, x: number, y: number, size: number): Label {
        const node = this.uiNode(text, parent, x, y, 920, 42);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 6;
        label.color = new Color(219, 230, 244, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
    }

    private button(parent: Node, text: string, x: number, callback: () => void): void {
        const node = this.uiNode(text, parent, x, -235, 148, 42);
        const background = node.addComponent(Graphics);
        background.fillColor = new Color(34, 51, 72, 255);
        background.roundRect(-74, -21, 148, 42, 8);
        background.fill();
        this.label(node, text, 0, 0, 15).getComponent(UITransform)!.setContentSize(148, 42);
        node.on(Node.EventType.TOUCH_END, callback);
    }

    private play(loop: boolean): void {
        const animation = this.player?.data?.animations[this.animationIndex];
        if (animation) this.player!.play(animation.id, loop);
    }
    private togglePause(): void {
        if (this.player?.clock.playing) this.player.pause();
        else this.player?.resume();
    }
    private next(): void {
        this.animationIndex = (this.animationIndex + 1) % (this.player?.data?.animations.length || 1);
        this.play(true);
    }
    private onKey(event: EventKeyboard): void {
        if (event.keyCode === KeyCode.SPACE) this.togglePause();
        else if (event.keyCode === KeyCode.KEY_L) this.play(true);
        else if (event.keyCode === KeyCode.KEY_N) this.play(false);
        else if (event.keyCode === KeyCode.TAB) this.next();
        else if (event.keyCode === KeyCode.ARROW_LEFT) this.player?.setFacingLeft(true);
        else if (event.keyCode === KeyCode.ARROW_RIGHT) this.player?.setFacingLeft(false);
    }

    update(): void {
        if (!this.player || !this.status || !this.graphics) return;
        const frame = this.player.currentFrame;
        this.status.string = this.lastError || (frame
            ? `${this.player.animation?.name}  |  frame ${frame.sourceFrame} · ${frame.durationMs.toFixed(0)} ms  |  ${this.player.faceLeft ? '← Left' : 'Right →'}  |  finish ${this.finishes} · audio ${this.audioEvents}`
            : 'Loading package…');
        this.graphics.clear();
        this.graphics.strokeColor = new Color(104, 126, 153, 255);
        this.graphics.moveTo(-10, 0); this.graphics.lineTo(10, 0);
        this.graphics.moveTo(0, -10); this.graphics.lineTo(0, 10); this.graphics.stroke();
        for (const box of this.player.queryBoxes()) {
            this.graphics.strokeColor = box.kind === 'hitbox' ? new Color(255, 114, 130, 255)
                : box.kind === 'collisionbox' ? new Color(247, 196, 93, 255) : new Color(77, 226, 215, 255);
            box.corners.forEach((point, index) => index === 0
                ? this.graphics!.moveTo(point.x, point.y) : this.graphics!.lineTo(point.x, point.y));
            this.graphics.close();
            this.graphics.stroke();
        }
    }

    onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        const host = globalThis as typeof globalThis & { __frameTunerDemo?: object };
        if (host.__frameTunerDemo === this.diagnostics) delete host.__frameTunerDemo;
    }
}
