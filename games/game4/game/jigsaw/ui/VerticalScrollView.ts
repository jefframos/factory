// VerticalScrollView.ts
import * as PIXI from "pixi.js";

export class VerticalScrollView extends PIXI.Container {

    public onScroll: () => void = () => { };

    public readonly content: PIXI.Container = new PIXI.Container();

    private readonly maskGfx: PIXI.Graphics = new PIXI.Graphics();
    private readonly hitAreaGfx: PIXI.Graphics = new PIXI.Graphics();

    private viewW: number;
    private viewH: number;

    private scrollY: number = 0;

    private dragging = false;
    private dragStartY = 0;
    private dragStartScroll = 0;

    public wheelSpeed: number = 40;

    public constructor(viewW: number, viewH: number) {
        super();

        this.viewW = viewW;
        this.viewH = viewH;

        // 1) A transparent interactive rect BEHIND content (so cards can be clicked)
        this.hitAreaGfx.beginFill(0x000000, 0.001);
        this.hitAreaGfx.drawRect(0, 0, viewW, viewH);
        this.hitAreaGfx.endFill();
        this.hitAreaGfx.eventMode = "static";
        this.addChild(this.hitAreaGfx);

        // 2) Content on top (interactive cards live here)
        this.addChild(this.content);

        // 3) Mask (mask doesn't need to be interactive)
        this.maskGfx.beginFill(0xffffff);
        this.maskGfx.drawRect(0, 0, viewW, viewH);
        this.maskGfx.endFill();
        this.addChild(this.maskGfx);

        this.content.mask = this.maskGfx;

        // Drag handlers on the hitArea only (works for empty space dragging)
        this.hitAreaGfx.on("pointerdown", this.onPointerDown, this);
        this.hitAreaGfx.on("pointerup", this.onPointerUp, this);
        this.hitAreaGfx.on("pointerupoutside", this.onPointerUp, this);
        this.hitAreaGfx.on("pointermove", this.onPointerMove, this);

        window.addEventListener("wheel", this.onWheel, { passive: false });
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        window.removeEventListener("wheel", this.onWheel as any);
        this.hitAreaGfx.off("pointerdown", this.onPointerDown as any);
        this.hitAreaGfx.off("pointerup", this.onPointerUp as any);
        this.hitAreaGfx.off("pointerupoutside", this.onPointerUp as any);
        this.hitAreaGfx.off("pointermove", this.onPointerMove as any);

        super.destroy(options);
    }
    public get currentScroll(): number { return this.scrollY; }

    public get maxScroll(): number {
        return Math.max(0, this.contentHeight() - this.viewH + 50);
    }

    private clampAndApply(): void {
        const maxScroll = this.maxScroll;

        if (this.scrollY < 0) this.scrollY = 0;
        if (this.scrollY > maxScroll) this.scrollY = maxScroll;

        this.content.y = -this.scrollY;

        // Notify the view that the scroll position changed
        this.onScroll();
    }

    // Existing methods to help the view scroll programmatically
    public scrollBy(delta: number): void {
        this.scrollY += delta;
        this.clampAndApply();
    }
    public setSize(viewW: number, viewH: number): void {
        if (this.viewW == viewW && this.viewH == viewH) {
            return;
        }
        this.viewW = viewW;
        this.viewH = viewH;

        this.maskGfx.clear();
        this.maskGfx.beginFill(0xffffff);
        this.maskGfx.drawRect(0, 0, viewW, viewH);
        this.maskGfx.endFill();

        this.hitAreaGfx.clear();
        this.hitAreaGfx.beginFill(0x000000, 0.001);
        this.hitAreaGfx.drawRect(0, 0, viewW, viewH);
        this.hitAreaGfx.endFill();

        this.clampAndApply();
    }

    public refresh(): void {
        this.clampAndApply();
    }

    public scrollToTop(): void {
        this.scrollY = 0;
        this.clampAndApply();
    }

    private onWheel = (e: WheelEvent): void => {
        // Only act if visible and on stage.
        if (!this.worldVisible || !this.parent) {
            return;
        }

        // Prevent page scrolling when cursor is over the view bounds.
        const rect = this.getBounds(true);
        const mx = e.clientX;
        const my = e.clientY;

        if (mx < rect.x || mx > rect.x + rect.width || my < rect.y || my > rect.y + rect.height) {
            return;
        }

        e.preventDefault();

        const delta = e.deltaY;
        this.scrollY += delta > 0 ? this.wheelSpeed : -this.wheelSpeed;
        this.clampAndApply();
    };

    private onPointerDown(e: PIXI.FederatedPointerEvent): void {
        this.dragging = true;
        this.dragStartY = e.global.y;
        this.dragStartScroll = this.scrollY;
    }

    private onPointerUp(): void {
        this.dragging = false;
    }

    private onPointerMove(e: PIXI.FederatedPointerEvent): void {
        if (!this.dragging) {
            return;
        }

        const dy = e.global.y - this.dragStartY;
        this.scrollY = this.dragStartScroll - dy;
        this.clampAndApply();
    }


    private contentHeight(): number {
        const b = this.content.getLocalBounds();
        return b.y + b.height;
    }
}
