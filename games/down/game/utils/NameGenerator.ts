/**
 * Adjective+animal nickname generator shared by the player's own random
 * default name (PlayerFlowController) and NPC display names (NpcNames) —
 * NPCs reusing the exact same word lists is what makes them read as other
 * players on the same server instead of visibly bot-flavored ("NPC 7").
 * Plain strings, not run through Localization: a nickname is a proper noun,
 * not UI copy, and shouldn't change when the player switches language.
 */
const ADJECTIVES = [
    'Swift', 'Brave', 'Lucky', 'Shiny', 'Quick', 'Bold', 'Sneaky', 'Mighty', 'Chubby', 'Rusty',
    'Silent', 'Feral', 'Grumpy', 'Jolly', 'Dizzy', 'Frosty', 'Spicy', 'Salty', 'Gnarly', 'Turbo',
    'Wobbly', 'Cosmic', 'Sleepy', 'Rowdy', 'Zesty', 'Ancient', 'Cheeky', 'Nimble', 'Gilded', 'Vicious',
    'Loyal', 'Feisty', 'Plucky', 'Stormy', 'Cursed', 'Radiant', 'Grim', 'Jumpy', 'Clever', 'Savage',
];
const ANIMALS = [
    'Fox', 'Wolf', 'Otter', 'Hawk', 'Panda', 'Tiger', 'Shark', 'Eagle', 'Slug', 'Newt',
    'Badger', 'Falcon', 'Lynx', 'Raven', 'Viper', 'Weasel', 'Mongoose', 'Jackal', 'Heron', 'Boar',
    'Ferret', 'Gecko', 'Marlin', 'Puffin', 'Bison', 'Cobra', 'Toad', 'Moose', 'Sparrow', 'Piranha',
    'Yak', 'Ocelot', 'Mantis', 'Walrus', 'Hyena', 'Gopher', 'Iguana', 'Pelican', 'Skunk', 'Wombat',
];

/**
 * @param withNumberChance 0..1 odds of appending a 0-99 suffix. Defaults to
 * always-on (the player's own fallback name always had one). NpcNames passes
 * a lower chance so only *some* NPCs carry a number — a real player base is a
 * mix of people who typed a custom name (no number) and people still on their
 * auto-generated default (number intact); an NPC roster that's ALL-numbered
 * or NONE-numbered reads as obviously synthetic either way.
 */
export function generateNickname(withNumberChance: number = 1): string {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const suffix = Math.random() < withNumberChance ? String(Math.floor(Math.random() * 100)) : '';
    return `${adjective}${animal}${suffix}`;
}
