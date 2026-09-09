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
// place rather than rebuilt-and-re-added) — showing the active task's
// requirement + reward, and hidden entirely (not a bubble/placeholder)
// whenever there's no active task at all (cooldown, or waiting for a
// giver to walk one in). Tracks a fixed point above the queue itself by
// default (`labelAnchor`) — UNLESS an optional `getPopupAnchorOverride`
// callback (see that field's own doc) returns a real position, which
// PizzaScene wires to the queue's own QuestGiverEntity so an `npc` variant's
// panel floats over its actual head instead.
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
import { buildSolidArea } from '../physics/SolidArea';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import { spawnFlyingResourceIcon, spawnFlyingIconToOverlayPoint } from '../components/FlyingResourceIcon';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { createResourceSlot } from '../ui/ResourceSlotVisual';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { resolvePopupFrameName, resolvePopupAnchorOffset, resolvePopupAvoidViewer } from '../ui/PopupConfig';
import { BackpackStorage } from '../data/BackpackStorage';
import { QueueStorage } from '../data/QueueStorage';
import { QueueConfig, getQueueConfig } from '../data/QueueTypes';
import { EconomyStorage } from '../data/EconomyStorage';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { findAnimalTypeForResource, AnimalType } from '../actions/AnimalTypes';
import { AnimalFollowStorage } from '../data/AnimalFollowStorage';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import MainPlayer from './MainPlayer';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';

const LABEL_FRAME_PADDING = uniformFitPadding(15);

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
/** Corner rounding for the floor outline — purely cosmetic, the collider itself stays a sharp-cornered box (see RigidBody above). */
const QUEUE_ZONE_CORNER_RADIUS = 0.3;
/** Where the reward icon departs from — roughly head-height above the zone, same idea as BuildingZone's own popup spawn point. */
const POPUP_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 2.2, 0);
/** Vertical gap between the requirements row and the reward line sitting above it — see refreshLabel(). */
const HEADER_BODY_GAP = 6;
/** One requirement slot per resource the active task asks for, laid out in a single horizontal row — same slot visual as BackpackUI (see ResourceSlotVisual.ts). Currently a queue task only ever asks for one resource (see QueueTypes.ts), but this is written as a row so a future multi-resource task needs no layout changes here. */
const REQ_SLOT_SIZE = 56;
const REQ_SLOT_GAP = 10;
const REWARD_ICON_SIZE = 22;
/** Same badge NotificationRarity.Common/LevelBadgeStyle's tier-2 use — see UpgradeStyle.ts/LevelBadgeStyle.ts's own usage — for the completion callout (see checkForCompletion()/refreshLabel()). Plain sprite, not nine-sliced (no FrameRegistry entry exists for it — neither of those existing call sites frames it either). */
const REWARD_BADGE_TEXTURE_KEY = 'Label_Badge01_Green';
/** Real asset is 129x132 (see public/pizza/images/ui.webp.json) — height/width, applied on top of REWARD_BADGE_SIZE so the badge doesn't stretch off-square. */
const REWARD_BADGE_ASPECT = 132 / 129;
const REWARD_BADGE_SIZE = 64;
/** Smaller than the badge itself so it reads as "sitting inside" it, not covering its own border art. */
const REWARD_BADGE_ICON_SIZE = 32;
/** Gap between the badge's own bottom edge and the "+N" caption below it — same icon-then-caption composition as UpgradeNotificationView's own badge+subtitle, just without that view's ribbon/spin effects (see this file's own doc on why this is the simpler, in-world version instead of reusing that screen-overlay system directly). */
const REWARD_BADGE_TEXT_GAP = 6;
const FLY_IN_STAGGER_SEC = 0.12;
/** How long the panel takes to fade in on becoming deliverable — see refreshLabel()'s own doc. Disappearing stays instant, same "pop out is fine, pop in isn't" convention ScreenAnchorComponent's own alpha fade uses. */
const LABEL_FADE_IN_SEC = 0.25;
/**
 * How long the panel HOLDS a clear "+N" completion callout (see checkForCompletion()) before
 * actually completing the task in QueueStorage (which is what starts the money icon's own
 * flight to the wallet, AND what a giver-driven queue's QuestGiverEntity polls to know it's
 * finally free to leave — see that file's own doc). Without this pause, the reward requirement
 * row disappeared and the giver started walking out the SAME frame the last unit landed — the
 * amount earned was never actually legible, just a number that was there one frame and gone
 * (replaced by an already-in-flight icon) the next.
 */
const REWARD_POPUP_HOLD_SEC = 2;

export default class QueueZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly queueId: string;
    private readonly config: QueueConfig;
    /** Overrides HALF_EXTENTS' X/Z (from a Tiled object's rect) — same reasoning as BuildingZone's own `footprint` param. Undefined means "use HALF_EXTENTS," same as before this existed. */
    private readonly footprint?: { width: number; depth: number };
    /** Where EconomyUI's money icon actually sits on screen right now — see flyRewardToWallet(). A callback (not a fixed point) since UIService repositions that panel every frame. */
    private readonly getWalletOverlayPosition: () => { x: number; y: number };
    /**
     * Live override for the task panel's own tracked BASE position — undefined (the default)
     * keeps `labelAnchor`'s fixed point above the queue itself, unchanged from before this
     * existed. PizzaScene wires this to QuestGiverEntity.getNpcHeadWorldPosition() (see
     * registerQueueSpawnGates()), which itself only ever returns a real position while THIS
     * cycle's giver is an animated `npc` variant with its rig already loaded — a static `view`
     * variant (or no giver at all) always reads back undefined here, so the panel only ever
     * actually moves to "over the NPC's head" for a queue that has one. The queue's own
     * `popupBobOffset` still applies ON TOP of this override, same as it does for `labelAnchor`
     * — see awake()'s own ScreenAnchorComponent target callback.
     */
    private readonly getPopupAnchorOverride?: () => THREE.Vector3 | undefined;
    /** Fires once, right when a task's full amount lands — BEFORE the REWARD_POPUP_HOLD_SEC pause even starts (see checkForCompletion()). PizzaScene wires this to QuestGiverGroup.playHappyAnimationForActiveGiver() so an `npc` variant plays its "happy" pose for the same window the reward callout holds, instead of just standing there (or already walking away) while the number's still on screen. Undefined (the default) is a no-op — a static-`view` giver (or no giver at all) has no animation to trigger anyway. */
    private readonly onTaskDelivered?: () => void;

    /** Resource type currently mid-drain via flyInResource()/flyInAnimal() — guards a second overlapping drain loop for the same active task. Cleared whenever the active task changes (a new task may ask for a different resource). */
    private drainingType?: ResourceType;
    /**
     * How many units of a given ResourceType have DEPARTED but not yet LANDED — see
     * flyInResource()/flyInAnimal()'s own doc for why this exists: `QueueStorage`'s progress
     * only advances on landing (0.45s flight), but departures fire every FLY_IN_STAGGER_SEC
     * (0.12s), so without this, `state.progress` alone can't tell the loop "N units are
     * already committed, don't send another" — it would keep departing extra units the task
     * doesn't need, over-draining the source. Incremented right before a departure, decremented
     * the instant that same unit lands (whether or not it was actually needed).
     *
     * A Map (keyed by type), same shape BuildingZone.inFlightByType/DropZone.inFlightByType/
     * CraftZone.inFlightByType already use — NOT a bare per-drain-call counter (an earlier
     * version of this file used one, reset to 0 at the top of every flyInResource() call,
     * which was the actual bug: a drain loop stopping and IMMEDIATELY restarting — onTriggerStay
     * fires every physics tick, well inside a single 0.45s flight — reset the count to 0 while
     * units were still mid-air, re-opening the departure gate and delivering MORE than the task
     * actually needed; confirmed with a queue needing 1 of something delivering ALL of it
     * instead). A Map entry is only ever mutated by increment-on-departure/decrement-on-landing,
     * never reset wholesale, so it stays correct across any number of loop stop/restarts AND
     * across a task change mid-flight (a leftover count for an abandoned type just sits under
     * its own key, harmless, until its own in-flight icons land).
     */
    private readonly inFlightByType = new Map<ResourceType, number>();
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
    /** Whether the panel was visible as of the LAST refreshLabel() call — see refreshLabel()'s own doc on why the fade-in only plays on the false->true edge, not on every rebuild while already shown (progress ticking rebuilds the panel constantly while a task is being delivered). */
    private wasDeliverable = false;
    /**
     * False for a queue that has its own QuestGiverEntity walking a waypoint path in/out (see
     * that file's own doc) — such a queue's pacing is driven entirely by the giver's own
     * arrival (QueueStorage.startTaskNow()), not this zone's timer-based
     * QueueStorage.tryRollNextTask(). Leaving BOTH enabled would let the timer's cooldown roll
     * a task on its own schedule, completely out of sync with (and possibly well before) the
     * giver physically walking in — see PizzaScene.setupQueues(), which passes false exactly
     * when a giver+path exists for this queue's id.
     */
    private readonly autoRollTasks: boolean;
    /** Set once, in destroy() — guards checkForCompletion()'s own delayedCall so it never fires any further completion/reward logic after this zone is torn down (same pattern QuestGiverEntity's own `destroyed` flag uses). */
    private destroyed = false;
    /** Set the instant a task's full amount lands, cleared the instant checkForCompletion()'s own REWARD_POPUP_HOLD_SEC pause actually completes it — see that method's own doc. Guards against starting a second overlapping pause (shouldn't happen — nothing can add MORE progress once a task is already fully delivered — but cheap to guard anyway) and is what refreshLabel() checks to render the callout instead of the normal progress row. */
    private pendingCompletionRewardAmount?: number;

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
        /** See `autoRollTasks`'s own doc. Defaults to true — unchanged behavior for a queue with no giver. */
        autoRollTasks = true,
        /** See `getPopupAnchorOverride`'s own doc. Undefined (the default) keeps every existing caller's fixed-anchor panel unchanged. */
        getPopupAnchorOverride?: () => THREE.Vector3 | undefined,
        /** See `onTaskDelivered`'s own doc. Undefined (the default) is a no-op — every existing caller keeps behaving exactly as before this existed. */
        onTaskDelivered?: () => void,
    ) {
        super();
        this.screenHost = screenHost;
        this.queueId = queueId;
        this.getWalletOverlayPosition = getWalletOverlayPosition;
        this.footprint = footprint;
        this.config = config;
        this.autoRollTasks = autoRollTasks;
        this.getPopupAnchorOverride = getPopupAnchorOverride;
        this.onTaskDelivered = onTaskDelivered;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        // Trigger footprint (X/Z) matches the visible box's own footprint when one was given —
        // same reasoning as BuildingZone.awake()'s identical halfExtents computation.
        const halfExtents = this.footprint
            ? new THREE.Vector3(this.footprint.width / 2, HALF_EXTENTS.y, this.footprint.depth / 2)
            : HALF_EXTENTS;

        const centerOffset = new THREE.Vector3(0, halfExtents.y, 0);
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset,
        }));

        const solidArea = buildSolidArea(halfExtents, centerOffset, this.config.solid ?? 0);
        if (solidArea) {
            this.addComponent(solidArea);
        }

        this.addComponent(new DottedZoneVisualComponent(
            halfExtents.x * 2,
            halfExtents.z * 2,
            QUEUE_ZONE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.Queue) },
        ));

        this.headerContainer = new PIXI.Container();
        this.bodyContainer = new PIXI.Container();

        const column = new PIXI.Container();
        column.addChild(this.headerContainer, this.bodyContainer);
        this.labelFrame = new AutoFitFrame(LABEL_FRAME_PADDING, resolvePopupFrameName(this.config.popupMode, 'QueueFrame', this.config.frame), column);

        // ScreenAnchorComponent.update() unconditionally sets ITS OWN content's `visible = true`
        // every frame the anchor is on-screen (see that file's own doc — it only ever hides
        // content for being off-screen/too far, it has no notion of "this queue has nothing to
        // show right now"). Passing `this.labelFrame` there directly would fight refreshLabel()'s
        // own `labelFrame.visible = false` every single frame, leaving an empty bubble on
        // screen instead of nothing. Wrapping it in this outer container gives
        // ScreenAnchorComponent something to toggle that ISN'T the same object refreshLabel()
        // controls — a PIXI child stays hidden if EITHER it or any ancestor is invisible, so
        // `labelFrame.visible = false` still wins regardless of what the wrapper's own
        // visibility is doing.
        const anchorContent = new PIXI.Container();
        anchorContent.addChild(this.labelFrame);

        // Kicks off this queue's very first task immediately (a brand-new queue has no
        // nextTaskAtEpochMs yet — see QueueStorage.tryRollNextTask()'s own doc) rather than
        // waiting for the first update() tick, so the panel never shows stale/blank content
        // on the very first frame it's built. Skipped entirely for a giver-driven queue (see
        // `autoRollTasks`'s own doc) — its first task starts once the giver actually arrives.
        if (this.autoRollTasks) {
            QueueStorage.tryRollNextTask(this.queueId, this.config);
        }
        this.refreshLabel();

        // A dedicated empty node the panel tracks, rather than a raw captured position —
        // parented under this.transform so it moves with the zone for free. Stored as a field
        // since flyInResource() targets the same spot — deposited icons fly to wherever this
        // queue's own UI actually renders, not a point on its placeholder box.
        // Same offset either way — see popupBobOffsetVec's own doc — computed once here rather
        // than re-derived from this.config every frame.
        const popupBobOffsetVec = resolvePopupAnchorOffset(this.config.popupBobOffset);

        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.copy(popupBobOffsetVec);
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            anchorContent,
            () => {
                // getPopupAnchorOverride() already returns a fresh Vector3 each call (see
                // QuestGiverEntity.getNpcHeadWorldPosition()'s own doc) — safe to mutate in place
                // rather than allocating yet another one just to add this offset on top. Applying
                // the SAME popupBobOffset here as labelAnchor's own position keeps a designer's
                // per-queue tuning meaningful for an `npc` variant too, instead of that config
                // silently doing nothing the moment a queue's giver happens to be animated.
                const override = this.getPopupAnchorOverride?.();
                return override ? override.add(popupBobOffsetVec) : this.labelAnchor.getWorldPosition(labelAnchorWorldPosition);
            },
            { ...ZONE_LABEL_ANCHOR_OPTIONS, ...resolvePopupAvoidViewer(this.config.popupMode) },
        ));

        QueueStorage.onTaskChanged.add(this.handleTaskChanged);

        // onTriggerStay (not just onTriggerEnter) makes this a CONTINUOUS deposit, same
        // reasoning as BuildingZone/DropZone — see either file's own doc.
        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    public override destroy(): void {
        this.destroyed = true;
        QueueStorage.onTaskChanged.remove(this.handleTaskChanged);
        super.destroy();
    }

    /**
     * Rolls a new task the instant this queue's cooldown elapses, with NO player proximity
     * required — a task should be waiting by the time a player wanders back, not only start
     * rolling once they arrive. Cheap: QueueStorage.tryRollNextTask() no-ops (returns false)
     * on every call except the rare moment a cooldown actually just passed. Skipped entirely
     * when `autoRollTasks` is false (see its own doc) — a giver-driven queue's
     * QuestGiverEntity is the only thing allowed to start its next task. Also ticks the
     * cooldown countdown TEXT every frame while on cooldown — see `cooldownText`'s own doc for
     * why that can't just be event-driven like everything else here.
     *
     * ALSO proactively retries checkForCompletion() every frame — not just reactively inside
     * flyInResource()'s landing callback. That reactive-only check is normally enough (progress
     * reaching the required amount and the completion check happen in the exact same callback),
     * but it's not a real guarantee: a task whose progress ever ends up at or past its required
     * amount WITHOUT that exact callback also noticing (an interrupted session, a save
     * edited/migrated externally, ...) had NO other path back to completion — it would just sit
     * there fully delivered forever, "10/10" and stuck, since nothing else ever re-checked it.
     * This is a cheap no-op the overwhelming majority of frames (checkForCompletion() itself
     * guards against starting a second overlapping reward pause), same as tryRollNextTask()
     * above, and makes completion self-healing regardless of how a task got into that state.
     */
    public override update(delta: number): void {
        super.update(delta);

        if (this.autoRollTasks) {
            QueueStorage.tryRollNextTask(this.queueId, this.config);
        }

        this.checkForCompletion();
    }

    /**
     * Called once a task's full amount has landed (from flyInResource()/flyInAnimal()'s own
     * landing callback, or proactively every frame from update() — see that method's own doc) —
     * shows a clear "+N" reward callout (see refreshLabel()) and fires `onTaskDelivered` (the
     * giver's own happy-animation hook) IMMEDIATELY, then holds that callout for
     * REWARD_POPUP_HOLD_SEC before actually completing the task in QueueStorage (which is what
     * starts the money icon's own flight to the wallet, AND what a giver-driven queue's
     * QuestGiverEntity polls to know it's finally free to leave). `pendingCompletionRewardAmount`
     * guards against starting a second overlapping pause on a later call this same window (the
     * task is already fully delivered by then — nothing can add more progress to it — but this
     * is also what makes update()'s own proactive retry a true no-op rather than re-triggering
     * the callout/animation every single frame of the hold).
     */
    private checkForCompletion(): void {
        if (this.pendingCompletionRewardAmount !== undefined) {
            return;
        }

        const state = QueueStorage.getState(this.queueId);
        const task = state.activeTask;
        if (!task || state.progress < task.amount) {
            return;
        }

        this.pendingCompletionRewardAmount = task.rewardAmount;
        this.onTaskDelivered?.();
        this.refreshLabel();

        gsap.delayedCall(REWARD_POPUP_HOLD_SEC, () => {
            if (this.destroyed) {
                return;
            }

            this.pendingCompletionRewardAmount = undefined;
            const completedTask = QueueStorage.tryCompleteTask(this.queueId, this.config);
            if (completedTask) {
                this.flyRewardToWallet(completedTask.rewardAmount);
            }
        });
    }

    /**
     * Rewrites the panel from QueueStorage's current state for this queue and re-fits the
     * frame around the new bounds — called on every actual state change (task rolled/progress
     * changed/task completed), not every frame. No title anywhere: the reward line sits where
     * a title normally would (headerContainer, above the requirements row). While there's no
     * active task (cooldown, or waiting for a giver to walk one in), the WHOLE panel just
     * hides — no "next task in Ns" bubble sitting there with nothing to say.
     *
     * Becoming deliverable (false -> true) fades the panel's alpha in from 0 instead of
     * popping straight to opaque — same "pop out is fine, pop in isn't" convention
     * ScreenAnchorComponent's own distance-based fade uses, just independent of it (this
     * panel can go from hidden to shown with the player standing right there the whole time,
     * not because of distance). Only the RISING edge fades — this method reruns (and rebuilds
     * header/body from scratch) on every progress tick while a task is already being
     * delivered, so re-triggering the fade on every one of those calls would flicker the
     * panel's opacity with every landed unit; `wasDeliverable` is what tells a genuine
     * appearance apart from "still deliverable, just rebuilding content."
     */
    private refreshLabel(): void {
        this.headerContainer.removeChildren().forEach(child => child.destroy({ children: true }));
        this.bodyContainer.removeChildren().forEach(child => child.destroy({ children: true }));

        // 'none' (see PopupConfig.ts's own doc) skips the panel entirely, permanently — the
        // deliverable-based show/hide/fade below never gets a chance to turn it back on.
        if (this.config.popupMode === 'none') {
            gsap.killTweensOf(this.labelFrame);
            this.labelFrame.visible = false;
            this.wasDeliverable = false;
            return;
        }

        const state = QueueStorage.getState(this.queueId);
        const task = state.activeTask;
        const deliverable = this.isTaskDeliverable();

        if (deliverable && !this.wasDeliverable) {
            gsap.killTweensOf(this.labelFrame);
            this.labelFrame.alpha = 0;
            this.labelFrame.visible = true;
            gsap.to(this.labelFrame, { alpha: 1, duration: LABEL_FADE_IN_SEC });
        } else if (!deliverable) {
            gsap.killTweensOf(this.labelFrame);
            this.labelFrame.visible = false;
            this.labelFrame.alpha = 1;
        }
        this.wasDeliverable = deliverable;

        if (!task || !deliverable) {
            return;
        }

        // Holds a badge-style "+N" callout in place of the normal reward line + requirements row
        // for as long as checkForCompletion()'s own REWARD_POPUP_HOLD_SEC pause lasts — see that
        // method's own doc for why: without this, the reward amount only ever showed as a small
        // number sitting ABOVE a row that vanished the same instant the last unit landed, easy to
        // miss entirely once the giver started walking off right alongside it. Styled after the
        // notification system's own badge+icon+caption composition (see UpgradeNotificationView.ts)
        // but deliberately simpler (no ribbon, no spinning shine) and IN-WORLD rather than a
        // screen-space overlay toast — this panel already tracks the right in-world position (the
        // queue/giver's own popup anchor, see awake()'s own ScreenAnchorComponent), so this just
        // reuses that instead of spawning a second, separate anchored popup on top of it.
        if (this.pendingCompletionRewardAmount !== undefined) {
            const badge = new PIXI.Sprite(PIXI.Texture.from(REWARD_BADGE_TEXTURE_KEY));
            badge.anchor.set(0.5, 0.5);
            badge.width = REWARD_BADGE_SIZE;
            badge.height = REWARD_BADGE_SIZE * REWARD_BADGE_ASPECT;

            const icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
            icon.anchor.set(0.5, 0.5);
            icon.width = REWARD_BADGE_ICON_SIZE;
            icon.height = REWARD_BADGE_ICON_SIZE;

            const text = new PIXI.Text(`+${this.pendingCompletionRewardAmount}`, TextStyleRegistry.Notification);
            text.anchor.set(0.5, 1);
            text.position.set(0, 0);

            badge.position.set(0, -(text.height + REWARD_BADGE_TEXT_GAP + badge.height / 2));
            icon.position.copy(badge.position);

            const callout = new PIXI.Container();
            callout.addChild(badge, icon, text);
            this.bodyContainer.addChild(callout);

            // Fit the FRAME at the callout's natural (scale 1) size FIRST — AutoFitFrame.fit()
            // just measures content's bounds at the moment it's called, so calling it AFTER
            // scaling the callout down to 0 (below) would size the frame around nothing, leaving
            // it collapsed/clipped for the whole pop-in instead of already the right size to pop
            // INTO (same "frame doesn't resize along with it" look every other icon-punch
            // animation in this game already has — see the jiggle convention this reuses).
            this.labelFrame.fit();

            // Pop-scale entrance — the same back.out(2) "jiggle punch" idiom already used all
            // over this game's UI (GlobalResourcesUI's/BackpackListUI's own gain jiggle,
            // MartPopup.playRowFeedback(), ...) rather than a new easing invented just for this.
            // Safe to play unconditionally here (not re-triggered every frame of the hold) since
            // this whole branch only actually runs once per completion — refreshLabel() isn't
            // called again until either QueueStorage.onTaskChanged fires (nothing does, for the
            // WHOLE hold — see checkForCompletion()'s own doc) or the hold itself ends and clears
            // `pendingCompletionRewardAmount`, which takes this branch out of the picture entirely.
            callout.scale.set(0);
            gsap.to(callout.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' });
            return;
        }

        // Reward line — icon + "+N", centered, sitting in the header area (see this method's
        // own doc). PIXI.Container has no `anchor`, so a bottom-center pivot reproduces the
        // same "bottom edge lands exactly at this container's local y=0" placement a
        // PIXI.Text with anchor (0.5, 1) gets for free. 'simple' (see PopupConfig.ts's own doc)
        // skips this reward line entirely — headerContainer just stays empty (zero size), same
        // as its own "no active task" state, so the frame naturally shrinks around only the
        // requirements row below.
        if (this.config.popupMode !== 'simple') {
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
        }

        // Requirements row — currently always exactly one slot (see REQ_SLOT_SIZE's own doc),
        // laid out the same "centered row, bottom edge at y=0" way
        // BuildingZone.refreshLabel() lays out its own (possibly multi-slot) row.
        const requirements = [{ resourceType: task.resourceType, amount: task.amount }];
        const slots = requirements.map(req => createResourceSlot(req.resourceType, REQ_SLOT_SIZE, `${state.progress}/${req.amount}`));
        const bodyHeight = Math.max(REQ_SLOT_SIZE, ...slots.map(slot => slot.visualHeight));

        const rowWidth = slots.length * REQ_SLOT_SIZE + Math.max(0, slots.length - 1) * REQ_SLOT_GAP;
        slots.forEach((slot, index) => {
            slot.container.position.set(-rowWidth / 2 + index * (REQ_SLOT_SIZE + REQ_SLOT_GAP), -bodyHeight);
            this.bodyContainer.addChild(slot.container);
        });

        this.headerContainer.position.set(0, -(bodyHeight + HEADER_BODY_GAP));
        this.labelFrame.fit();
    }

    /**
     * True only when this queue actually has something the player can deliver into RIGHT NOW
     * — an active task existing in QueueStorage is NOT enough on its own for a giver-driven
     * queue (`autoRollTasks === false`): a task can be active/persisted (e.g. survived a page
     * reload) well before its QuestGiverEntity has finished walking back in this session, and
     * the player must not be able to deposit into (or even see the panel for) a task the giver
     * hasn't actually brought yet — see QueueStorage.setGiverPresent()'s own doc. A queue with
     * no giver at all (`autoRollTasks === true`) only ever needs the plain activeTask check.
     */
    private isTaskDeliverable(): boolean {
        const hasTask = QueueStorage.getState(this.queueId).activeTask !== undefined;
        return hasTask && (this.autoRollTasks || QueueStorage.isGiverPresent(this.queueId));
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer)) {
            return;
        }

        const activeTask = QueueStorage.getState(this.queueId).activeTask;
        if (!activeTask || !this.isTaskDeliverable()) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;

        // A task whose resourceType is actually ANIMAL-backed (see findAnimalTypeForResource()'s
        // own doc — e.g. "bring 1 Pig") delivers from AnimalFollowStorage's own follower list
        // instead of the backpack — completely different source, same flying-icon payoff.
        const animalType = findAnimalTypeForResource(activeTask.resourceType);
        if (animalType) {
            this.flyInAnimal(activeTask.resourceType, animalType);
        } else {
            this.flyInResource(activeTask.resourceType);
        }
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
     * gate also subtracts `inFlightByType` (units already departed but not yet landed) from
     * what's still needed — `state.progress` alone lags behind by up to a full flight
     * duration, so gating on it alone would keep departing units the task doesn't need
     * (see `inFlightByType`'s own doc). No-ops (and clears `drainingType`) the instant the
     * player leaves, the task completes/changes, the backpack runs out, or the FBX character
     * (and so the backpack cube) hasn't loaded yet.
     */
    private flyInResource(type: ResourceType): void {
        if (this.drainingType === type) {
            return;
        }
        this.drainingType = type;

        const icon = getAssetIcon(resolveResourceAssetKey(type));
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const inFlight = this.inFlightByType.get(type) ?? 0;
            const state = QueueStorage.getState(this.queueId);
            const task = state.activeTask;
            const stillNeedsThisType = this.isPlayerInside && this.isTaskDeliverable() && task?.resourceType === type
                && state.progress + inFlight < task.amount;

            // Subtracting inFlight here too (not just from the task-amount check above) is what
            // actually closes the over-drain bug: without it, a backpack holding only 1 unit
            // would still read getCount()>0 for every departure that fires before the first one
            // lands (0.12s stagger vs. a ~0.45s flight), sending out more units than the
            // backpack really has and over-crediting the task on landing.
            const fromWorld = stillNeedsThisType && BackpackStorage.getCount(type) - inFlight > 0
                ? this.player?.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition()
                : undefined;

            if (!fromWorld) {
                this.drainingType = undefined;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlightByType.set(type, inFlight + 1);

            spawnFlyingResourceIcon(this.screenHost, fromWorld.clone(), toWorld.clone(), icon, () => {
                this.inFlightByType.set(type, (this.inFlightByType.get(type) ?? 1) - 1);
                if (!BackpackStorage.removeOne(type)) {
                    return;
                }
                QueueStorage.addProgress(this.queueId, 1);
                this.checkForCompletion();
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }

    /**
     * Same self-rescheduling step() shape (and the same `drainingType`/`inFlightByType`
     * re-entrancy guards) as flyInResource() — the ONLY thing that actually differs is where a
     * unit comes from: AnimalFollowStorage.deliverOneFollowerOfType(animalType) instead of
     * BackpackStorage, which ATOMICALLY picks-and-removes a live follower and hands back the
     * world position it departed from (or undefined if none are currently following) — see that
     * method's own doc. Because that removal is already immediate/synchronous (not deferred to
     * landing the way BackpackStorage.removeOne() is), the landing callback here only needs to
     * credit QueueStorage's own progress, nothing else.
     */
    private flyInAnimal(type: ResourceType, animalType: AnimalType): void {
        if (this.drainingType === type) {
            return;
        }
        this.drainingType = type;

        const icon = getAssetIcon(resolveResourceAssetKey(type));
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const inFlight = this.inFlightByType.get(type) ?? 0;
            const state = QueueStorage.getState(this.queueId);
            const task = state.activeTask;
            const stillNeedsThisType = this.isPlayerInside && this.isTaskDeliverable() && task?.resourceType === type
                && state.progress + inFlight < task.amount;

            const departedFrom = stillNeedsThisType ? AnimalFollowStorage.deliverOneFollowerOfType(animalType) : undefined;

            if (!departedFrom) {
                this.drainingType = undefined;
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlightByType.set(type, inFlight + 1);

            spawnFlyingResourceIcon(this.screenHost, new THREE.Vector3(departedFrom.x, departedFrom.y, departedFrom.z), toWorld.clone(), icon, () => {
                this.inFlightByType.set(type, (this.inFlightByType.get(type) ?? 1) - 1);
                QueueStorage.addProgress(this.queueId, 1);
                this.checkForCompletion();
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
