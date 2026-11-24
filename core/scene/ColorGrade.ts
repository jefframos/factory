// ColorGrade.ts
//
// The 3D's colours a little richer: every material's last step (three's colorspace_fragment chunk) pushes its colour
// away from grey — the duller it is the more (a vibrance), so the lawn and the paths wake up and what's already vivid
// (the sea, the confetti) doesn't burn. No extra pass: a few instructions a pixel. Not the 2D UI. (Mow, UFO.)
//
// install() once, before anything's drawn. A material with its own onBeforeCompile must call apply() in it (or the one it
// replaces): without, it's just left as it was (the uniform's 0).

import * as THREE from 'three';

/** How much: 0 = as it was; the debug panel's Look slider. */
export const COLOR_GRADE = { vibrance: { value: 0.35 } };

const UNIFORM = 'uColorVibrance';

/** Gives a compiling shader the grade's uniform. */
function apply(shader: { uniforms: Record<string, THREE.IUniform> }): void {
    shader.uniforms[UNIFORM] = COLOR_GRADE.vibrance;
}

let installed = false;

export const ColorGrade = {
    apply,

    install(): void {
        if (installed) return;
        installed = true;
        THREE.ShaderChunk.colorspace_pars_fragment += `\nuniform float ${UNIFORM};\n`;
        THREE.ShaderChunk.colorspace_fragment += /* glsl */ `
            {
                float _gradeGrey = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                float _gradeVivid = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)) - min(gl_FragColor.r, min(gl_FragColor.g, gl_FragColor.b));
                gl_FragColor.rgb = clamp(mix(vec3(_gradeGrey), gl_FragColor.rgb, 1.0 + ${UNIFORM} * (1.0 - clamp(_gradeVivid, 0.0, 1.0))), 0.0, 1.0);
            }
        `;
        THREE.Material.prototype.onBeforeCompile = function (shader) {
            apply(shader);
        };
    },
};
