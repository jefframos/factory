/**
 * Single source of truth for the NPC roster/director system — same role
 * LinearConfig.ts plays for room config. Tune values here; nothing else in
 * npc/ should hardcode a number that belongs in one of these groups.
 */

export const NPC_POPULATION_CONFIG = {
    /** Total persistent NPC records — constant; entries are recycled, never added/removed. */
    rosterSize: 35,
    /** How many roster entries are materialized as real, on-screen bots near the player at once. */
    activeMin: 4,
    activeMax: 8,
    /** Head value a record resets to after being killed (by another idle NPC, or for real via EntityEating). */
    respawnValue: 2,
    /**
     * Seconds of world time the roster is seeded to look like it's already
     * been running — makes a freshly booted server read as an ongoing one
     * instead of every NPC starting at respawnValue simultaneously. This is
     * the only input the seeding simulation takes, so a different value per
     * game session/lobby is how two "rooms" end up with different-looking
     * populations — an older room just simulates more seconds. See
     * NpcRoster.seedPopulation / GrowthSimulator.
     */
    seedElapsedSeconds: 900,
    /**
     * Exponent shaping each record's simulated feeding-time budget out of
     * seedElapsedSeconds (rank^skew, rank 0 = weakest .. 1 = the leader) —
     * see NpcRoster.seedPopulation. Higher = most records get a much shorter
     * effective feeding window (staying close to respawnValue) while only
     * the very top ranks approach the full seedElapsedSeconds. Lowered from
     * 4 alongside the seedElapsedSeconds bump above so the top of the
     * leaderboard reads meaningfully higher, not just the same curve
     * stretched — rank is normalized (rank/(n-1)) so a bigger roster alone
     * doesn't raise the leader's budget on its own.
     */
    seedSkew: 3,
};

export const NPC_SAFE_START_CONFIG = {
    /**
     * Seconds after a player joins where NPC materialization near them
     * always favors weak, docile records — same treatment as
     * lowLevelPlayerThreshold below, but gated on wall-clock time instead of
     * player value. Guarantees a minimum grace window even for a player who
     * gets lucky and grows past the value threshold in the first few
     * seconds; a quick early win shouldn't cut the "figure out the controls
     * without dying" period short.
     */
    graceSeconds: 30,
};

export const NPC_PERSONALITY_CONFIG = {
    /**
     * Base BotParams every materialized NPC starts from (see
     * DEFAULT_BOT_PARAMS in Blackboard.ts) — raise `aggressiveness` here to
     * make the whole population bolder as a baseline, independent of the
     * per-NPC random variance below.
     */
    aggressiveness: 0.5,
    awarenessRadius: 32,
    fleeThreshold: 0.6,
    wanderSpeed: 0.6,
    leashRadius: 55,
    /**
     * Per-materialized-NPC random variance applied on top of the base values
     * above (± range, clamped to each param's valid range) so the population
     * reads as individuals instead of identical clones. E.g.
     * aggressivenessVariance: 0.2 means each NPC's actual aggressiveness
     * lands somewhere in [aggressiveness - 0.2, aggressiveness + 0.2].
     */
    aggressivenessVariance: 0.2,
    awarenessRadiusVariance: 8,
};

export const NPC_IDLE_SIM_CONFIG = {
    /**
     * Seconds between idle feed ticks. Deliberately its own knob, not a
     * reuse of LinearConfig's FOOD_CONFIG.spawnInterval — that constant
     * governs the real on-screen food spawner; tuning idle NPC growth
     * shouldn't silently retune how fast food appears in the world, or vice versa.
     *
     * The VALUE distribution fed on each tick, unlike the interval, is NOT
     * duplicated here — it reads LinearConfig.rollFoodValue() (see
     * NpcRoster), the same shared config the real on-screen spawner uses, so
     * "what values can food be, and how likely each is" is one game-wide
     * knob instead of two that can silently drift apart.
     */
    feedInterval: 3.5,
    /** Seconds between "one idle NPC swallows another" rolls. */
    killEventInterval: 20,
    /** Seconds between "one idle NPC nibbles another's weakest tail cube" rolls. */
    stealEventInterval: 12,
};

export const NPC_SPAWN_CONFIG = {
    /** How often (seconds) the director re-checks distances and tops up the active window. */
    checkInterval: 0.5,
    /** A materialized NPC beyond this world-units distance from the player is dematerialized back into the roster. */
    despawnDistance: 90,
    /** New materializations land in this ring around the player — far enough to usually be off-camera, close enough to reach quickly. */
    spawnMinDistance: 40,
    spawnMaxDistance: 70,
};

export const NPC_DIFFICULTY_CONFIG = {
    /**
     * Player value at/below which spawn selection favors weak, docile NPCs
     * instead of a uniform random pick from the whole roster — without this,
     * a fresh level-2 player can just as easily get a heavily-grown, fully
     * aggressive NPC materialized right next to them as their very first
     * encounter.
     */
    lowLevelPlayerThreshold: 8,
    /**
     * While the player is at/below the threshold, only materialize idle
     * records whose score is at most this multiple of the player's value.
     * Falls back to the full idle pool if none qualify (same fallback shape
     * as spawnBotNear's own candidate filter in BoundlessWorld3dScene) —
     * the roster can age past the low-value range entirely given enough
     * playtime, and a strict-only filter would then spawn nothing at all.
     */
    lowLevelValueMultiplier: 2,
    /** Aggressiveness ceiling applied to NPCs spawned while the player is at/below the threshold — overrides the normal jitter from NPC_PERSONALITY_CONFIG. */
    lowLevelAggressivenessCap: 0.2,
};

export const NPC_HUNT_CONFIG = {
    /**
     * Current value (not spawn-time — this is checked live, so a bot can
     * grow into hunter status mid-game) at/above which chaseWeakerPrey stops
     * requiring prey to be strictly weaker and instead treats anything up to
     * preyCeilingMult as fair game — a real "hunt" state for the biggest
     * bots, instead of every NPC only ever going after things smaller than
     * itself. Kept comfortably below fleeThreshold's ~1.67x cutoff so a
     * hunter's own flee reflex still fires against something genuinely
     * bigger.
     */
    valueThreshold: 32,
    /** Multiple of a hunter's own value it's willing to chase — see valueThreshold. */
    preyCeilingMult: 1.3,
};

export const NPC_RUBBERBAND_CONFIG = {
    /**
     * The real player's score must beat the best score anywhere in the NPC
     * roster (active or idle) by at least this multiple to count as
     * "leading" — see NpcDirector.isPlayerLeading. Below this margin, a
     * player who's merely tied for the top spot doesn't trigger anything.
     */
    leadMarginMult: 1.15,
    /**
     * While leading, this fraction of new NPC materializations near the
     * player deliberately pick the single biggest available idle record
     * (instead of NpcDirector's normal weak-bias/uniform-random pick) and
     * roll it as a hunter — see NpcDirector.materializeOne.
     */
    hunterSpawnChance: 0.5,
    /** Aggressiveness forced onto a rubber-band hunter spawn, overriding the normal jitter/low-level cap. */
    hunterAggressiveness: 1,
    /**
     * A rubber-band hunter is willing to chase the real player specifically
     * even while the player is bigger than it, as long as its own value is
     * at least this fraction of the player's — see BotParams.huntsBiggerPrey
     * and chaseWeakerPrey. Deliberately player-only (checked via
     * EntitySnapshot.isPlayer): this doesn't make hunters generally braver
     * against other big NPCs, just against whoever's actually winning.
     */
    hunterMinValueRatio: 0.55,
};
