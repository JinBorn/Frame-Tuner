import { _decorator, AudioClip, AudioSource, Component, ImageAsset, JsonAsset, Node, Rect,
    resources, Size, Sprite, SpriteFrame, Texture2D, UITransform, Vec3 } from 'cc';
import { BakedAnimation, BakedFrame, FrameBox, FrameTunerPackage, boxCorners, frameAnchor } from './FrameTunerData';
import { FrameTunerClock } from './FrameTunerClock';
const { ccclass, property } = _decorator;

export interface RuntimeBox {
    kind: string;
    source: FrameBox;
    sourceFrame: number;
    /** Local to this player node; world=true applies this node's world matrix. */
    corners: Vec3[];
}

@ccclass('FrameTunerPlayer')
export class FrameTunerPlayer extends Component {
    @property({ tooltip: 'resources-relative manifest path without .json' })
    packagePath = 'frame-tuner/demo/manifest';
    @property autoPlay = true;
    @property faceLeft = false;
    @property mute = false;
    @property({ min: 0.0001, tooltip: 'Baked pixels per Cocos unit; 1 matches a UI canvas.' })
    pixelsPerUnit = 1;
    @property({ min: 0 }) speed = 1;

    public readonly clock = new FrameTunerClock();
    public data: FrameTunerPackage | null = null;
    public animation: BakedAnimation | null = null;
    public currentFrame: BakedFrame | null = null;
    private sprite: Sprite | null = null;
    private audioSource: AudioSource | null = null;
    private frames = new Map<string, SpriteFrame>();
    private clips = new Map<string, AudioClip>();
    private textures: Texture2D[] = [];
    private images: ImageAsset[] = [];
    private loadGeneration = 0;
    private mirrored = false;
    private advancing = false;
    private pendingAudioFrame: BakedFrame | null = null;

    onLoad(): void {
        const visual = new Node('Frame Tuner Visual');
        visual.layer = this.node.layer;
        this.node.addChild(visual);
        visual.addComponent(UITransform);
        this.sprite = visual.addComponent(Sprite);
        this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.audioSource = this.addComponent(AudioSource);
    }

    start(): void {
        if (this.autoPlay && this.loadGeneration === 0) this.load(this.packagePath).then(() => this.play()).catch(error => this.reportError(error));
    }

    async load(manifestPath = this.packagePath): Promise<void> {
        const generation = ++this.loadGeneration;
        this.clock.stop();
        const asset = await new Promise<JsonAsset>((resolve, reject) => {
            resources.load(manifestPath, JsonAsset, (error, value) => error ? reject(error) : resolve(value));
        });
        if (generation !== this.loadGeneration || !this.isValid) return;
        const data = asset.json as FrameTunerPackage;
        if (data?.schema !== 'frame-tuner-package-v1' || data.version !== 1 || data.bakedVisual !== true ||
            data.coordinateSystem?.y !== 'down' || !Array.isArray(data.animations)) {
            throw new Error('Unsupported Frame Tuner package. Export a baked version 1 package.');
        }
        this.releaseVisuals();
        this.data = null;
        this.animation = null;
        this.currentFrame = null;
        const base = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
        const allFrames = data.animations.flatMap(animation => animation.frames).filter(frame => !frame.disabled);
        // Creator 3.8's loose Babel spread transform assumes arrays and turns
        // [...new Set(...)] into [].concat(set). Array.from preserves iteration.
        const imagePaths = Array.from(new Set(allFrames.map(frame => frame.path)));
        const audioPaths = Array.from(new Set(allFrames.flatMap(frame => (frame.audio || []).map(audio => audio.path))));
        // Load sequentially so cancellation never leaks an asset retained by this component.
        for (const imagePath of imagePaths) {
            const image = await new Promise<ImageAsset>((resolve, reject) => {
                resources.load(base + this.resourcePath(imagePath), ImageAsset, (error, value) => error ? reject(error) : resolve(value));
            });
            if (generation !== this.loadGeneration || !this.isValid) return;
            image.addRef();
            this.images.push(image);
            const texture = new Texture2D();
            texture.image = image;
            this.textures.push(texture);
            for (const source of allFrames.filter(frame => frame.path === imagePath)) {
                const key = this.frameKey(source);
                if (this.frames.has(key)) continue;
                const frame = new SpriteFrame();
                frame.texture = texture;
                frame.rect = source.atlasRect
                    ? new Rect(source.atlasRect.x, source.atlasRect.y, source.atlasRect.width, source.atlasRect.height)
                    : new Rect(0, 0, image.width, image.height);
                frame.originalSize = new Size(source.width, source.height);
                frame.packable = false;
                this.frames.set(key, frame);
            }
        }
        for (const audioPath of audioPaths) {
            const clip = await new Promise<AudioClip>((resolve, reject) => {
                resources.load(base + this.resourcePath(audioPath), AudioClip, (error, value) => error ? reject(error) : resolve(value));
            });
            if (generation !== this.loadGeneration || !this.isValid) return;
            clip.addRef();
            this.clips.set(audioPath, clip);
        }
        this.packagePath = manifestPath;
        this.data = data;
        this.node.emit('frame-tuner-ready', data);
    }

    play(animationId?: string, loop?: boolean): boolean {
        if (!this.data) return false;
        const animation = animationId ? this.data.animations.find(item => item.id === animationId) : this.data.animations[0];
        if (!animation) throw new Error(`Unknown animation: ${animationId}`);
        if (!(this.pixelsPerUnit > 0) || !Number.isFinite(this.pixelsPerUnit)) throw new Error('pixelsPerUnit must be positive.');
        this.animation = animation;
        const result = this.clock.start(animation.frames, loop ?? animation.loop, {
            frame: index => this.enterFrame(animation.frames[index]),
            loop: cycles => this.node.emit('frame-tuner-loop', { animationId: animation.id, cycles }),
            finish: () => this.node.emit('frame-tuner-finished', { animationId: animation.id }),
        });
        if (!result && this.sprite) { this.sprite.spriteFrame = null; this.currentFrame = null; }
        return result;
    }

    pause(): void { this.clock.pause(); }
    resume(): void { this.clock.resume(); }
    stop(): void { this.clock.stop(); }
    setFacingLeft(value: boolean): void { this.faceLeft = value; this.applyGeometry(); }

    update(deltaSeconds: number): void {
        this.applyGeometry();
        this.advancing = true;
        this.pendingAudioFrame = null;
        try {
            this.clock.advance(Math.max(0, deltaSeconds * 1000 * (Number.isFinite(this.speed) ? Math.max(0, this.speed) : 0)));
        } finally {
            this.advancing = false;
        }
        // A slow render update can cross many frames. Keep gameplay events, but only
        // play the final visible frame's sound instead of a burst of overdue sounds.
        if (this.pendingAudioFrame && this.pendingAudioFrame === this.currentFrame) this.playAudio(this.pendingAudioFrame);
    }

    queryBoxes(kind?: string, world = false): RuntimeBox[] {
        const frame = this.currentFrame;
        if (!frame) return [];
        return (frame.boxes || []).filter(box => box.enabled && (!kind || box.kind === kind)).map(box => ({
            kind: box.kind,
            source: box,
            sourceFrame: frame.sourceFrame,
            corners: boxCorners(box, this.faceLeft !== !!this.animation?.sourceFacesLeft, this.pixelsPerUnit).map(point => {
                const result = new Vec3(point.x, point.y, 0);
                return world ? Vec3.transformMat4(result, result, this.node.worldMatrix) : result;
            }),
        }));
    }

    private enterFrame(frame: BakedFrame): void {
        this.currentFrame = frame;
        if (this.sprite) this.sprite.spriteFrame = this.frames.get(this.frameKey(frame)) || null;
        this.applyGeometry();
        // Frame events include enabled frames crossed during a slow render update.
        this.node.emit('frame-tuner-frame', { animationId: this.animation?.id, frame });
        if (this.currentFrame !== frame) return;
        for (const audio of frame.audio || []) {
            this.node.emit('frame-tuner-audio', { animationId: this.animation?.id, sourceFrame: frame.sourceFrame, audio });
            if (this.currentFrame !== frame) return;
        }
        if (this.advancing) this.pendingAudioFrame = frame;
        else this.playAudio(frame);
    }

    private playAudio(frame: BakedFrame): void {
        for (const audio of frame.audio || []) {
            const clip = this.clips.get(audio.path);
            if (!this.mute && clip) this.audioSource?.playOneShot(clip, Math.max(0, Math.min(1, audio.volume ?? 1)));
        }
    }

    private frameKey(frame: BakedFrame): string {
        const rect = frame.atlasRect;
        return rect ? `${frame.path}:${rect.x},${rect.y},${rect.width},${rect.height}` : frame.path;
    }

    private applyGeometry(): void {
        if (!this.sprite || !this.currentFrame || !(this.pixelsPerUnit > 0)) return;
        const frame = this.currentFrame;
        const anchor = frameAnchor(frame);
        const transform = this.sprite.getComponent(UITransform)!;
        transform.setContentSize(frame.width, frame.height);
        transform.setAnchorPoint(anchor.x, anchor.y);
        this.mirrored = this.faceLeft !== !!this.animation?.sourceFacesLeft;
        this.sprite.node.setScale((this.mirrored ? -1 : 1) / this.pixelsPerUnit, 1 / this.pixelsPerUnit, 1);
    }

    private resourcePath(file: string): string {
        if (typeof file !== 'string' || !file || file.includes('..') || file.startsWith('/') || file.includes('\\') || file.includes(':')) throw new Error(`Invalid asset path: ${file}`);
        return file.replace(/\.[^/.]+$/, '');
    }

    private reportError(error: unknown): void {
        console.error('[Frame Tuner]', error);
        this.node.emit('frame-tuner-error', error);
    }

    private releaseVisuals(): void {
        if (this.sprite) this.sprite.spriteFrame = null;
        this.frames.forEach(frame => frame.destroy());
        this.frames.clear();
        this.textures.forEach(texture => texture.destroy());
        this.textures = [];
        this.images.forEach(image => image.decRef());
        this.images = [];
        this.clips.forEach(clip => clip.decRef());
        this.clips.clear();
    }

    onDestroy(): void { this.loadGeneration += 1; this.clock.stop(); this.releaseVisuals(); }
}
