// The UFO tab: this game's own settings (ui/ufo.json `ufo`, `camera` and `people`). The game reloads when the file is saved.

import { api, el, toast } from './shared.js';

const FIELDS = {
    ufo: [
        ['startRadius', 'Start radius', 'The saucer\'s size at the start: what fits under it.'],
        ['speed', 'Speed', 'Units per second at radius 0.'],
        ['speedPerRadius', 'Speed per radius', 'How much faster each unit of radius flies.'],
        ['accel', 'Acceleration', 'How quickly it reaches its speed and stops.'],
        ['altitudeBase', 'Altitude base', 'Altitude = base + per radius × radius.'],
        ['altitudePerRadius', 'Altitude per radius', 'How much higher each unit of radius flies: anything taller blocks it.'],
        ['growth', 'Growth', 'Radius² gained per point of an eaten thing\'s value.'],
        ['valuePower', 'Value power', 'A thing\'s value = its volume ^ this. Lower: big things count for less.'],
        ['growSpeed', 'Grow speed', 'How quickly the saucer eases to its new size.'],
        ['waterMargin', 'Over the water', 'How far past the shore it can fly before it stops, with arrows pointing back to land.'],
        ['collideShare', 'Collision size', 'The share of its radius that hits things too tall to fly over.'],
    ],
    people: [
        ['speed', 'Walking speed', ''],
        ['height', 'Height', 'Keep it under the saucer\'s starting height to eat them from the start.'],
        ['wander', 'Wander distance', 'How far away people in a wander area pick their next spot. Where people are and how many: the People card in the Town tab.'],
        ['pauseMin', 'Shortest stop (seconds)', ''],
        ['pauseMax', 'Longest stop (seconds)', ''],
    ],
    camera: [
        ['pitchDeg', 'Pitch (degrees)', 'How steeply it looks down at the start.'],
        ['endPitchDeg', 'Pitch when grown', 'It steepens to this as the saucer grows, which keeps the big saucer from looking stretched.'],
        ['endPitchRadius', 'Grown radius', 'The saucer\'s radius when it reaches that pitch.'],
        ['fov', 'Field of view', ''],
        ['distance', 'Distance', 'From the saucer, at altitude 0.'],
        ['perAltitude', 'Distance per altitude', 'How far it pulls back as the saucer climbs.'],
        ['maxShare', 'Largest saucer on screen', 'The share of the screen\'s narrower side it can fill (0.3 is 30%) before the camera pulls back further.'],
        ['followSpeed', 'Follow speed', ''],
        ['zoomSpeed', 'Zoom speed', ''],
        ['bend', 'World bend', 'How strongly the world curves away. 0 is flat, 0.002 is the same as the mow game.'],
    ],
};

let dirty = false;
export const hasUnsavedUfo = () => dirty;

export async function initUfoTab(host) {
    const settings = await api('/api/mow');
    const edits = { ufo: {}, camera: {}, people: {} };
    const field = (section, [key, label, hint]) => el('label', {},
        el('span', {}, label, hint ? el('small', {}, hint) : null),
        el('input', {
            type: 'number', step: 'any', value: String(settings[section][key]),
            oninput: (event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value)) {
                    edits[section][key] = value;
                    dirty = true;
                }
            },
        }));
    const save = async () => {
        try {
            await api('/api/ufo', { method: 'PUT', body: JSON.stringify(edits) });
            dirty = false;
            toast('Saved');
        } catch (error) {
            toast(error.message, 'error');
        }
    };
    host.replaceChildren(el('div', { class: 'ufo-form' },
        el('h2', {}, 'UFO'), FIELDS.ufo.map((entry) => field('ufo', entry)),
        el('h2', {}, 'People'), FIELDS.people.map((entry) => field('people', entry)),
        el('h2', {}, 'Camera'), FIELDS.camera.map((entry) => field('camera', entry)),
        el('button', { class: 'primary', onclick: save }, '💾 Save')));
}
