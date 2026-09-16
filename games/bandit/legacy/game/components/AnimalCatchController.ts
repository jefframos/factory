// AnimalCatchController.ts
//
// The player-side half of catching an AnimalNode — deliberately NOT built
// on PlayerActionController's repeated-hit cycle the way AutoGatherController
// (Chop/Mine/Gather) is. Capture works differently: the player just has to
// stand in the animal's trigger, continuously meeting its `requirementItem`/
// `requirementAmount` (if any — some animals need nothing at all, see
// AnimalTypes.ts's own doc), for `captureSec` straight. No swing timing, no
// tool shown in-hand, no animation layer — a plain elapsed-time counter,
// visualized as a fill bar over the animal's own head (AnimalNode.
// showCaptureProgress()). Leaving the trigger OR losing the requirement
// resets the timer to 0 — no partial-progress carry-over the way a
// ResourceNode's damage survives walking away.
//
// A completed catch does NOT bank anything to BackpackStorage — see
// AnimalTypes.ts's own doc, "they are resources but they won't go to the
// backpack." Instead: a heart pops (AnimalNode.showCaughtPopup()),
// AnimalFollowStorage reserves it a follower slot, and the SAME live
// AnimalNode switches from wild-wandering to following the player
// (AnimalNode.startFollowing()) — it never despawns on a successful catch.
// A capture attempt can't even START while AnimalFollowStorage.hasRoom() is
// false (MAX_FOLLOWERS reached) — see isEligible().
//
// Kept as a fully SEPARATE component/pipeline from AutoGatherController for
// the same reason ANIMAL_CONFIG is its own file rather than folded into
// ProviderConfig — this codebase already has precedent for "add a new
// gather-ish mechanic as its own parallel system" rather than deep-editing a
// shared one (see LooseResourceNode/DynamicResourceSpawner.ts's own doc,
// "a SECOND resource system, independent of the [ResourceNode/WorldManager]
// one"). AnimalCatchController is a THIRD, same idea.
//
// Missing-requirement feedback: onTriggerEnter shows the SAME "action
// blocked" bubble AutoGatherController.notifyMissingTool() does
// (PlayerNotificationComponent.showBlocked()) the instant the player walks
// up to an animal they can't currently catch because of its ITEM
// requirement — shown ONCE per fresh overlap, not spammed every frame
// update() re-checks it. A full follower list blocks capture the same way
// but deliberately shows no bubble (there's no single "missing item" icon
// that would make sense for it) — the UI planned for AnimalFollowStorage's
// own follower list will make "you're full" self-evident once it exists.

import Component from '../ecs/Component';
import RigidBody from '../physics/RigidBody';
import FacingComponent from './FacingComponent';
import PlayerNotificationComponent from './PlayerNotificationComponent';
import AnimalNode from '../player/AnimalNode';
import { ANIMAL_CONFIG } from '../actions/AnimalTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { getItemIcon } from '../crafting/ItemTypes';
import { AnimalFollowStorage } from '../data/AnimalFollowStorage';

export default class AnimalCatchController extends Component {
    /** Every AnimalNode whose trigger the player is currently standing inside — same "track every overlap, not just the one that triggered this" reasoning as AutoGatherController's own `overlapping`. */
    private readonly overlapping = new Set<AnimalNode>();

    /** The animal currently being timed, if any — undefined means no capture in progress. */
    private capturingAnimal?: AnimalNode;
    private captureElapsedSec = 0;

    public awake(): void {
        const rigidBody = this.entity.getComponent(RigidBody)!;
        rigidBody.onTriggerEnter.add(other => this.onTriggerEnter(other));
        rigidBody.onTriggerExit.add(other => this.onTriggerExit(other));
    }

    private onTriggerEnter(other: RigidBody): void {
        const animal = other.entity;
        if (!(animal instanceof AnimalNode)) {
            return;
        }

        this.overlapping.add(animal);
        // Green ('ready') only if this catch could actually start right now — orange
        // ('blocked') otherwise, whether that's the item requirement or a full follower list
        // (see isEligible()'s own doc for both halves of that check).
        animal.setCaptureState(this.isEligible(animal) ? 'ready' : 'blocked');
        if (!this.meetsItemRequirement(animal)) {
            this.notifyBlocked(animal);
        }
    }

    /** Leaving an animal's trigger always cancels an in-progress capture on THAT animal — unlike AutoGatherController's own exit handler, there's no "mid-completion, still technically busy" race to guard against here (nothing here ever unregisters a RigidBody synchronously the way ResourceNode.applyHit() does), so this can cancel unconditionally. */
    private onTriggerExit(other: RigidBody): void {
        const animal = other.entity;
        if (!(animal instanceof AnimalNode)) {
            return;
        }

        this.overlapping.delete(animal);
        animal.setCaptureState('neutral');
        if (this.capturingAnimal === animal) {
            this.cancelCapture();
        }
    }

    /**
     * Runs the whole timer every frame: keeps (or picks) whichever overlapping animal is
     * actually eligible right now, ticks its elapsed time, updates its progress bar, and
     * completes the catch once `captureSec` is reached. Re-checks eligibility every frame
     * (not just on trigger enter) so losing the requirement mid-capture (spending the rope
     * elsewhere, say) cancels immediately instead of silently finishing anyway.
     */
    public update(delta: number): void {
        // Keeps every overlapping ring's own color live — eligibility can change while the
        // player just stands there without ever leaving/re-entering the trigger (the
        // requirement item gets spent elsewhere, or a follower slot frees up), same reasoning
        // this method's own doc gives for re-checking the actively-capturing animal below.
        for (const animal of this.overlapping) {
            if (animal !== this.capturingAnimal) {
                animal.setCaptureState(this.isEligible(animal) ? 'ready' : 'blocked');
            }
        }

        if (this.capturingAnimal && (!this.overlapping.has(this.capturingAnimal) || !this.isEligible(this.capturingAnimal))) {
            this.cancelCapture();
        }

        if (!this.capturingAnimal) {
            for (const animal of this.overlapping) {
                if (this.isEligible(animal)) {
                    this.startCapture(animal);
                    break;
                }
            }
        }

        if (!this.capturingAnimal) {
            return;
        }

        const config = ANIMAL_CONFIG[this.capturingAnimal.animalType];
        this.captureElapsedSec += delta;
        const fraction = config.captureSec > 0 ? this.captureElapsedSec / config.captureSec : 1;
        this.capturingAnimal.showCaptureProgress(fraction);

        if (fraction >= 1) {
            this.completeCapture(this.capturingAnimal);
        }
    }

    private startCapture(animal: AnimalNode): void {
        this.capturingAnimal = animal;
        this.captureElapsedSec = 0;
        // Live reference (see AnimalNode.position's own doc) — keeps turning to face it as it
        // wanders for however much of the timer it spends still in range.
        this.entity.getComponent(FacingComponent)?.faceToward(animal.position);
    }

    private cancelCapture(): void {
        this.capturingAnimal?.hideCaptureProgress();
        this.entity.getComponent(FacingComponent)?.clearTarget();
        this.capturingAnimal = undefined;
        this.captureElapsedSec = 0;
    }

    /**
     * The catch itself — no BackpackStorage credit at all (see this file's own doc). Reserves
     * the follower slot BEFORE switching this animal's own mode, so a slot is never "spent"
     * without an actual follower to show for it if something above were ever to reorder.
     */
    private completeCapture(animal: AnimalNode): void {
        const config = ANIMAL_CONFIG[animal.animalType];
        this.entity.getComponent(FacingComponent)?.clearTarget();
        this.capturingAnimal = undefined;
        this.captureElapsedSec = 0;

        AnimalFollowStorage.addFollower(animal.animalType);
        console.log(`[catch] caught ${config.label} — now following`);
        animal.showCaughtPopup();
        animal.startFollowing(() => this.entity.transform.position);
    }

    /** Both halves of "can a capture attempt even start on `animal` right now" — its own item requirement (see AnimalConfig.requirementItem's own doc) AND room in the follower list (see AnimalFollowStorage.MAX_FOLLOWERS). */
    private isEligible(animal: AnimalNode): boolean {
        return this.meetsItemRequirement(animal) && AnimalFollowStorage.hasRoom();
    }

    /** True if `animal` needs nothing at all (see AnimalConfig.requirementItem's own doc), or the player owns at least `requirementAmount` of it. */
    private meetsItemRequirement(animal: AnimalNode): boolean {
        const config = ANIMAL_CONFIG[animal.animalType];
        return config.requirementItem === undefined || ItemStorage.hasCount(config.requirementItem, config.requirementAmount ?? 1);
    }

    /** Mirrors AutoGatherController.notifyMissingTool() — see this file's own doc for why it's shown only once, from onTriggerEnter. */
    private notifyBlocked(animal: AnimalNode): void {
        const config = ANIMAL_CONFIG[animal.animalType];
        if (config.requirementItem === undefined) {
            return;
        }
        // requirementAmount ?? 1 — same default meetsItemRequirement() itself uses, so the
        // number shown here always matches what's actually being checked.
        this.entity.getComponent(PlayerNotificationComponent)?.showBlocked(getItemIcon(config.requirementItem), config.requirementAmount ?? 1);
    }
}
