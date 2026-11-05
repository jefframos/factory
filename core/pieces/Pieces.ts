// Pieces.ts
//
// Things assembled from data: each piece is a simple shape or a model, with a colour and a transform. Plain enough for
// an editor to create and change them, and shared by the games and their editors (a web editor gets this file with its
// types stripped: tools/world-editor/server.mjs), so a piece looks the same in both.
//
// The shapes are all 1 unit across and centred, so a piece's scale is its size.

import * as THREE from 'three';

export type PieceShape = 'sphere' | 'box' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'model';

export interface Piece {
    name: string;
    shape: PieceShape;
    /** `shape: 'model'`: its path, for the loader given to buildPiece(). */
    model?: string;
    color?: string;
    /** How much it glows in its own colour (0..1 and up). */
    glow?: number;
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    rz: number;
    sx: number;
    sy: number;
    sz: number;
    /** How far it slides about with the owner's movement (a googly pupil), for a game that does that. */
    look?: number;
}

export const PIECE_SHAPES: PieceShape[] = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule'];

const geometries = new Map<PieceShape, THREE.BufferGeometry>();

function geometryFor(shape: PieceShape): THREE.BufferGeometry {
    let geometry = geometries.get(shape);
    if (geometry) return geometry;
    switch (shape) {
        case 'box': geometry = new THREE.BoxGeometry(1, 1, 1); break;
        case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); break;
        case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 24); break;
        case 'torus': geometry = new THREE.TorusGeometry(0.36, 0.14, 12, 32); break;
        case 'capsule': geometry = new THREE.CapsuleGeometry(0.25, 0.5, 8, 20); break;
        default: geometry = new THREE.SphereGeometry(0.5, 28, 20);
    }
    geometries.set(shape, geometry);
    return geometry;
}

/** Puts an object where a piece (or anything with the same transform fields) says. */
export function placePiece(object: THREE.Object3D, piece: Pick<Piece, 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz'>): void {
    object.position.set(piece.x, piece.y, piece.z);
    object.rotation.set(piece.rx, piece.ry, piece.rz);
    object.scale.set(piece.sx, piece.sy, piece.sz);
}

/** A piece's object, placed; null if its model can't be had. A shape's material is its own: free it with freePiece(). */
export async function buildPiece(piece: Piece, loadModel: (path: string) => Promise<THREE.Object3D>): Promise<THREE.Object3D | null> {
    let object: THREE.Object3D;
    if (piece.shape === 'model') {
        if (!piece.model) return null;
        try {
            object = await loadModel(piece.model);
        } catch (error) {
            console.warn(`[Pieces] could not load ${piece.model}`, error);
            return null;
        }
    } else {
        const color = new THREE.Color(piece.color ?? '#ffffff');
        object = new THREE.Mesh(geometryFor(piece.shape), new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: piece.glow ?? 0,
            roughness: 0.55,
        }));
    }
    placePiece(object, piece);
    return object;
}

/** Frees what buildPiece() made for a shape (shapes share their geometry; models belong to their loader). */
export function freePiece(object: THREE.Object3D, piece: Piece): void {
    if (piece.shape !== 'model' && object instanceof THREE.Mesh) (object.material as THREE.Material).dispose();
}
