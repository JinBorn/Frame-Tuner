export interface TimedFrame { durationMs: number; disabled?: boolean }
export interface ClockCallbacks {
    frame?(index: number): void;
    loop?(cycles: number): void;
    finish?(): void;
}

/** Keeps elapsed remainders, visits every crossed frame, and never schedules disabled frames. */
export class FrameTunerClock {
    public frameIndex = -1;
    public elapsedMs = 0;
    public cycles = 0;
    public playing = false;
    public finished = false;
    private frames: TimedFrame[] = [];
    private indices: number[] = [];
    private position = 0;
    private looped = true;
    private callbacks: ClockCallbacks = {};
    private generation = 0;

    start(frames: TimedFrame[], loop: boolean, callbacks: ClockCallbacks = {}): boolean {
        this.stop();
        this.frames = frames;
        this.indices = frames.flatMap((frame, index) => frame.disabled ? [] : [index]);
        for (const index of this.indices) {
            if (!Number.isFinite(frames[index].durationMs) || frames[index].durationMs <= 0) {
                throw new Error(`Frame ${index} needs a positive durationMs.`);
            }
        }
        this.callbacks = callbacks;
        this.looped = loop;
        this.position = 0;
        this.cycles = 0;
        this.elapsedMs = 0;
        this.finished = false;
        this.frameIndex = this.indices[0] ?? -1;
        this.playing = this.indices.length > 0;
        if (this.playing) this.callbacks.frame?.(this.frameIndex);
        return this.playing;
    }

    pause(): void { this.playing = false; }
    resume(): void { if (this.frameIndex >= 0 && !this.finished) this.playing = true; }
    stop(): void { this.playing = false; this.generation += 1; }

    advance(deltaMs: number): void {
        if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('deltaMs must be finite and nonnegative.');
        if (!this.playing) return;
        const generation = this.generation;
        this.elapsedMs += deltaMs;
        while (this.playing && generation === this.generation) {
            const duration = this.frames[this.frameIndex].durationMs;
            if (this.elapsedMs + 1e-8 < duration) break;
            this.elapsedMs = Math.max(0, this.elapsedMs - duration);
            this.position += 1;
            let completedCycle = false;
            if (this.position === this.indices.length) {
                if (!this.looped) {
                    this.position -= 1;
                    this.elapsedMs = duration;
                    this.playing = false;
                    this.finished = true;
                    this.callbacks.finish?.();
                    break;
                }
                this.position = 0;
                this.cycles += 1;
                completedCycle = true;
            }
            this.frameIndex = this.indices[this.position];
            this.callbacks.frame?.(this.frameIndex);
            if (completedCycle && generation === this.generation) this.callbacks.loop?.(this.cycles);
        }
    }
}
