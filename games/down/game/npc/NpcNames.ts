import { generateNickname } from '../utils/NameGenerator';

/**
 * NPC display names — deliberately plain strings, NOT routed through
 * Localization. Unlike UI copy, a name is a proper noun: "SwiftFox42" isn't
 * translated into French any more than a real player's chosen nickname
 * would be, and picking a fresh word per locale (as the old "NPC {id}" /
 * "PNJ {id}" keys did) just made the same NPC appear to change identity
 * when the player switched language.
 *
 * Reuses PlayerFlowController's own random-name generator (see
 * NameGenerator.generateNickname) instead of a bot-flavored word list, so
 * NPCs read as other players on the server. Only some get the trailing
 * number — see generateNickname's own doc for why an all-or-nothing split
 * would look synthetic either way.
 */
const NPC_NUMBER_SUFFIX_CHANCE = 0.5;
const MAX_DEDUPE_ATTEMPTS = 10;

/**
 * Assign once per NpcRecord (see NpcRoster) — the result stays fixed for
 * that record's whole lifetime, including across respawns.
 * @param taken Names already assigned elsewhere in the roster — retried
 * against (up to MAX_DEDUPE_ATTEMPTS) so the initial population reads as
 * distinct individuals; not a hard guarantee, since the roster is much
 * smaller than the name space and a rare repeat is harmless.
 */
export function generateNpcName(taken?: ReadonlySet<string>): string {
    let name = generateNickname(NPC_NUMBER_SUFFIX_CHANCE);
    if (!taken) return name;

    let attempts = 0;
    while (taken.has(name) && attempts < MAX_DEDUPE_ATTEMPTS) {
        name = generateNickname(NPC_NUMBER_SUFFIX_CHANCE);
        attempts++;
    }
    return name;
}
