// QueueZone.ts
//
// A BuildingZone-style trigger, but for a repeating TASK QUEUE instead of a
// one-way upgrade ladder: while a task is active, pulls its required
// resource out of BackpackStorage one unit at a time (same continuous
// drain-while-inside-trigger + flying-icon cascade BuildingZone/DropZone
// use), crediting QueueStorage.addProgress(). Once the task's full amount
// is delivered, QueueStorage.tryCompleteTask() clears it and starts a
// cooldown, and a money icon flies from this queue to EconomyUI's wallet
// (see flyRewardToWallet()) — EconomyStorage is only credited once that
// icon actually ARRIVES, same "storage mutates on landing, not on
// departure" convention every other deposit flow here already follows.
// This zone rolls the next task automatically once the cooldown elapses
// (see update()) — no player proximity required for a new task to become
// available, only to fulfill one.
//
// Carries a PERSISTENT nameplate/task panel the same way BuildingZone's
// requirements panel does (ScreenAnchorComponent, no ttlSec, mutated in
// place rather than rebuilt-and-re-added) — showing either the active
// task's requirement + reward, or a "next task in Ns" countdown while on
// cooldown, so a player standing right there never sees a blank panel.
//
// Queue ids come straight from whatever's drawn on the Tiled map (see
// WorldObjectRegistry.getAllOfType()/PizzaScene.setupQueues()) rather than
// a fixed enum like BuildingId/GateId — this entity doesn't know or care how
// many queues exist elsewhere.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import { spawnFlyingResourceIcon, spawnFlyingIconToOverlayPoint } from '../components/FlyingResourceIcon';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { createResourceSlot } from '../ui/ResourceSlotVisual';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { BackpackStorage } from '../data/BackpackStorage';
import { QueueStorage } from '../data/QueueStorage';
import { QueueConfig, getQueueConfig } from '../data/QueueTypes';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { RESOURCE_ASSET_KEYS } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import MainPlayer from './MainPlayer';

const LABEL_FRAME_PADDING = uniformFitPadding(15);

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
/** Placeholder box color — distinct from DropZone's green/BuildingZone's own mesh, so a queue reads as its own kind of zone on the map until real art exists. */
const QUEUE_BOX_COLOR = 0xcc8800;
const LABEL_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 1.2, 0);
/** Where the reward icon departs from — roughly head-height above the zone, same idea as BuildingZone's own popup spawn point. */
const POPUP_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 2.2, 0);
/** Vertical gap between the requirements row and the reward line sitting above it — see refreshLabel(). */
const HEADER_BODY_GAP = 6;
/** One requirement slot per resource the active task asks for, laid out in a single horizontal row — same slot visual as BackpackUI (see ResourceSlotVisual.ts). Currently a queue task only ever asks for one resource (see QueueTypes.ts), but this is written as a row so a future multi-resource task needs no layout changes here. */
const REQ_SLOT_SIZE = 56;
const REQ_SLOT_GAP = 10;
const REWARD_ICON_SIZE = 22;
const FLY_IN_STAGGER_SEC = 0.12;

export default class QueueZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly queueId: string;
    private readonly config: QueueConfig;
    /** Overrides HALF_EXTENTS' X/Z (from a Tiled object's rect) — same reasoning as BuildingZone's own `footprint` param. Undefined means "use HALF_EXTENTS," same as before this existed. */
    private readonly footprint?: { width: number; depth: number };
    /** Where EconomyUI's money icon actually sits on screen right now — see flyRewardToWallet(). A callback (not a fixed point) since UIService repositions that panel every frame. */
    private readonly getWalletOverlayPosition: () => { x: number; y: number };

    /** Resource type currently mid-drain via flyInResource() — guards a second overlapping drain loop for the same active task. Cleared whenever the active task changes (a new task may ask for a different resource). */
    private drainingType?: ResourceType;
    /**
     * How many units have DEPARTED but not yet LANDED for the current drain — see
     * flyInResource()'s own doc for why this exists: `QueueStorage`'s progress only advances
     * on landing (0.45s flight), but departures fire every FLY_IN_STAGGER_SEC (0.12s), so
     * without this, `state.progress` alone can't tell the loop "10 units are already
     * committed, don't send an 11th" — it would keep departing extra units the task doesn't
     * need, over-draining the backpack. Incremented right before a departure, decremented the
     * instant that same unit lands (whether or not it was actually needed).
     */
    private inFlightCount = 0;
    /** True for as long as the player's RigidBody is inside this zone's trigger — flyInResource()'s per-unit loop checks this before every unit and stops the instant it goes false. */
    private isPlayerInside = false;
    /** The player entity currently inside this zone — undefined whenever isPlayerInside is false. */
    private player?: MainPlayer;
    /** Where deposited icons fly TO — the same anchor this zone's own task panel tracks (see awake()). */
    private labelAnchor!: THREE.Object3D;

    /** The reward line (money icon + "+N") sitting above the requirements row — see refreshLabel(). Empty (zero size) whenever there's no active task, e.g. during cooldown. */
    private headerContainer!: PIXI.Container;
    /** Holds either the active task's requirement row (see ResourceSlotVisual.ts), or a "next task in Ns" countdown — rebuilt wholesale by refreshLabel() on every actual state change (see handleTaskChanged()). No title anywhere — the reward line IS the header, see this file's own doc. */
    private bodyContainer!: PIXI.Container;
    private labelFrame!: AutoFitFrame;
    /** Set by refreshLabel() only while on cooldown (no active task) — update() ticks its text every frame from QueueStorage's own timestamp, since time passing isn't itself a QueueStorage mutation/Signal. Undefined whenever a task is active. */
    private cooldownText?: PIXI.Text;

    private readonly handleTaskChanged = (id: string): void => {
        if (id === this.queueId) {
            this.refreshLabel();
        }
    };

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        queueId: string,
        getWalletOverlayPosition: () => { x: number; y: number },
        footprint?: { width: number; depth: number },
        config: QueueConfig = getQueueConfig(queueId),
    ) {
        super();
        this.screenHost = screenHost;
        this.queueId = queueId;
        this.getWalletOverlayPosition = getWalletOverlayPosition;
        this.footprint = footprint;
        this.config = config;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        // Trigger footprint (X/Z) matches the visible box's own footprint when one was given —
        // same reasoning as BuildingZone.awake()'s identical halfExtents computation.
        const halfExtents = this.footprint
            ? new THREE.Vector3(this.footprint.width / 2, HALF_EXTENTS.y, this.footprint.depth / 2)
            : HALF_EXTENTS;

        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, halfExtents.y, 0),
        }));
        this.addComponent(new BoxVisualComponent(
            halfExtents.clone().multiplyScalar(2),
            QUEUE_BOX_COLOR,
            new THREE.Vector3(0, halfExtents.y, 0),
        ));

        this.headerContainer = new PIXI.Container();
        this.bodyContainer = new PIXI.Container();

        const column = new PIXI.Container();
        column.addChild(this.headerContainer, this.bodyContainer);
        this.labelFrame = new AutoFitFrame(LABEL_FRAME_PADDING, 'Popup', column);

        // Kicks off this queue's very first task immediately (a brand-new queue has no
        // nextTaskAtEpochMs yet — see QueueStorage.tryRollNextTask()'s own doc) rather than
        // waiting for the first update() tick, so the panel never shows stale/blank content
        // on the very first frame it's built.
        QueueStorage.tryRollNextTask(this.queueId, this.config);
        this.refreshLabel();

        // A dedicated empty node the panel tracks, rather than a raw captured position —
        // parented under this.transform so it moves with the zone for free. Stored as a field
        // since flyInResource() targets the same spot — deposited icons fly to wherever this
        // queue's own UI actually renders, not a point on its placeholder box.
        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.copy(LABEL_HEIGHT_OFFSET);
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.labelFrame,
            () => this.labelAnchor.getWorldPosition(labelAnchorWorldPosition),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));

        QueueStorage.onTaskChanged.add(this.handleTaskChanged);

        // onTriggerStay (not just onTriggerEnter) makes this a CONTINUOUS deposit, same
        // reasoning as BuildingZone/DropZone — see either file's own doc.
        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    public override destroy(): void {
        QueueStorage.onTaskChanged.remove(this.handleTaskChanged);
        super.destroy();
    }

    /**
     * Rolls a new task the instant this queue's cooldown elapses, with NO player proximity
     * required — a task should be waiting by the time a player wanders back, not only start
     * rolling once they arrive. Cheap: QueueStorage.tryRollNextTask() no-ops (returns false)
     * on every call except the rare moment a cooldown actually just passed. Also ticks the
     * cooldown countdown TEXT every frame while on cooldown — see `cooldownText`'s own doc for
     * why that can't just be event-driven like everything else here.
     *
     * ALSO proactively retries QueueStorage.tryCompleteTask() every frame — not just reactively
     * inside flyInResource()'s landing callback. That reactive-only check is normally enough
     * (progress reaching the required amount and the completion check happen in the exact same
     * callback), but it's not a real guarantee: a task whose progress ever ends up at or past
     * its required amount WITHOUT that exact callback also completing it (an interrupted
     * session, a save edited/migrated externally, ...) had NO other path back to completion —
     * it would just sit there fully delivered forever, "10/10" and stuck, since nothing else
     * ever re-checked it. This is a cheap no-op the overwhelming majority of frames, same as
     * tryRollNextTask() above, and makes completion self-healing regardless of how a task got
     * into that state.
     */
    public override update(delta: number): void {
        super.update(delta);

        QueueStorage.tryRollNextTask(this.queueId, this.config);

        const completedTask = QueueStorage.tryCompleteTask(this.queueId, this.config);
        if (completedTask) {
            this.flyRewardToWallet(completedTask.rewardAmount);
        }

        if (this.cooldownText) {
            const nextAt = QueueStorage.getState(this.queueId).nextTaskAtEpochMs;
            const remainingSec = nextAt !== undefined ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)) : 0;
            this.cooldownText.text = `Next task in ${remainingSec}s`;
        }
    }

    /**
     * Rewrites the panel from QueueStorage's current state for this queue and re-fits the
     * frame around the new bounds — called on every actual state change (task rolled/progress
     * changed/task completed), not every frame (see update()'s own doc for the one thing that
     * DOES need a per-frame tick). No title anywhere: while a task is active, the reward line
     * sits where a title normally would (headerContainer, above the requirements row); while
     * on cooldown there's nothing to reward yet, so just the countdown text shows.
     */
    private refreshLabel(): void {
        this.cooldownText = undefined;

        this.headerContainer.removeChildren().forEach(child => child.destroy({ children: true }));
        this.bodyContainer.removeChildren().forEach(child => child.destroy({ children: true }));

        const state = QueueStorage.getState(this.queueId);
        let headerHeight = 0;
        let bodyHeight: number;

        if (!state.activeTask) {
            const nextAt = state.nextTaskAtEpochMs;
            const remainingSec = nextAt !== undefined ? Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)) : 0;
            const text = new PIXI.Text(`Next task in ${remainingSec}s`, TextStyleRegistry.Body);
            text.anchor.set(0.5, 1);
            this.bodyContainer.addChild(text);
            this.cooldownText = text;
            bodyHeight = text.height;
        } else {
            const task = state.activeTask;

            // Reward line — icon + "+N", centered, sitting in the header area (see this
            // method's own doc). PIXI.Container has no `anchor`, so a bottom-center pivot
            // reproduces the same "bottom edge lands exactly at this container's local y=0"
            // placement a PIXI.Text with anchor (0.5, 1) gets for free.
            const rewardIcon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
            rewardIcon.anchor.set(0, 0.5);
            rewardIcon.width = REWARD_ICON_SIZE;
            rewardIcon.height = REWARD_ICON_SIZE;
            this.headerContainer.addChild(rewardIcon);

            const rewardText = new PIXI.Text(`+${task.rewardAmount}`, TextStyleRegistry.Body);
            rewardText.anchor.set(0, 0.5);
            rewardText.position.set(REWARD_ICON_SIZE + 4, 0);
            this.headerContainer.addChild(rewardText);

            this.headerContainer.pivot.set(this.headerContainer.width / 2, this.headerContainer.height);
            headerHeight = this.headerContainer.height;

            // Requirements row — currently always exactly one slot (see REQ_SLOT_SIZE's own
            // doc), laid out the same "centered row, bottom edge at y=0" way
            // BuildingZone.refreshLabel() lays out its own (possibly multi-slot) row.
            const requirements = [{ resourceType: task.resourceType, amount: task.amount }];
            const slots = requirements.map(req => createResourceSlot(req.resourceType, REQ_SLOT_SIZE, `${state.progress}/${req.amount}`));
            bodyHeight = Math.max(REQ_SLOT_SIZE, ...slots.map(slot => slot.visualHeight));

            const rowWidth = slots.length * REQ_SLOT_SIZE + Math.max(0, slots.length - 1) * REQ_SLOT_GAP;
            slots.forEach((slot, index) => {
                slot.container.position.set(-rowWidth / 2 + index * (REQ_SLOT_SIZE + REQ_SLOT_GAP), -bodyHeight);
                this.bodyContainer.addChild(slot.container);
            });
        }

        this.headerContainer.position.set(0, -(bodyHeight + (headerHeight > 0 ? HEADER_BODY_GAP : 0)));
        this.labelFrame.fit();
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer)) {
            return;
        }

        const activeTask = QueueStorage.getState(this.queueId).activeTask;
        if (!activeTask) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;
        this.flyInResource(activeTask.resourceType);
    }

    /** Player's RigidBody left this zone's trigger — flyInResource()'s loop reads isPlayerInside before every unit, so clearing it here is the ENTIRE "stop depositing" instruction; nothing further needs to be cancelled explicitly. Same shape as BuildingZone/DropZone's identical handler. */
    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }

        this.isPlayerInside = false;
        this.player = undefined;
    }

    /**
     * Drains `type` out of BackpackStorage one unit at a time toward this queue's ACTIVE task,
     * re-checking isPlayerInside and the task's current identity/progress before every single
     * unit — not a fixed burst computed once at trigger time. Same self-rescheduling step()
     * shape as BuildingZone.flyInResource() — see that file's own doc, EXCEPT the departure
     * gate also subtracts `inFlightCount` (units already departed but not yet landed) from
     * what's still needed — `state.progress` alone lags behind by up to a full flight
     * duration, so gating on it alone would keep departing units the task doesn't need
     * (see `inFlightCount`'s own doc). No-ops (and clears `drainingType`) the instant the
     * player leaves, the task completes/changes, the backpack runs out, or the FBX character
     * (and so the backpack cube) hasn't loaded yet.
     */
    private flyInResource(type: ResourceType): void {
        if (this.drainingType === type) {
            return;
        }
        this.drainingType = type;
        this.inFlightCount = 0;

        const icon = getAssetIcon(RESOURCE_ASSET_KEYS[type]);
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const state = QueueStorage.getState(this.queueId);
            const task = state.activeTask;
            const stillNeedsThisType = this.isPlayerInside && task?.resourceType === type
                && state.progress + this.inFlightCount < task.amount;

            const fromWorld = stillNeedsThisType && BackpackStorage.getCount(type) > 0
                ? this.player?.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition()
                : undefined;

            if (!fromWorld) {
                this.drainingType = undefined;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlightCount++;

            spawnFlyingResourceIcon(this.screenHost, fromWorld.clone(), toWorld.clone(), icon, () => {
                this.inFlightCount--;
                BackpackStorage.removeOne(type);
                QueueStorage.addProgress(this.queueId, 1);
                const completedTask = QueueStorage.tryCompleteTask(this.queueId, this.config);
                if (completedTask) {
                    this.flyRewardToWallet(completedTask.rewardAmount);
                }
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }

    /**
     * Task completion's payoff — flies ONE money icon from this queue's own position to
     * wherever EconomyUI's wallet icon actually renders right now (see
     * getWalletOverlayPosition's own doc), crediting EconomyStorage only once it ARRIVES —
     * see this file's own doc for why the credit happens on landing, not on departure. That
     * credit is what makes EconomyUI's own onChange-driven jiggle/"+N" popup play at the
     * wallet itself, so this needs no separate floating popup of its own the way the old
     * chip-based deposit effects did before spawnFlyingIconToOverlayPoint() existed.
     */
    private flyRewardToWallet(rewardAmount: number): void {
        const icon = getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey);
        const fromWorld = this.transform.position.clone().add(POPUP_HEIGHT_OFFSET);

        spawnFlyingIconToOverlayPoint(this.screenHost, fromWorld, this.getWalletOverlayPosition, icon, () => {
            EconomyStorage.add(CurrencyType.Money, rewardAmount);
        });
    }
}
