// GarageData.ts
//
// Typed access to ui/garage.json — the garage's design data (service bays, customer cars, the
// player's own car, upgrade tracks, races), edited in the garage editor (`npm run level`).

import data from '../../ui/garage.json';

export interface GarageBay {
    id: string;
    x: number;
    z: number;
    /** Degrees around the vertical axis. */
    rotationY: number;
}

export interface CustomerCar {
    id: string;
    /** Path under public/garage/models/, e.g. cars/sedan.glb. */
    model: string;
    /** Cash paid when the repair is done. */
    repairReward: number;
    /** Seconds the repair takes. */
    repairTime: number;
}

export interface PlayerCar {
    model: string;
    x: number;
    z: number;
    rotationY: number;
}

export interface UpgradeTrack {
    id: string;
    name: string;
    /** Price of each level, in order. */
    prices: number[];
}

export interface RaceData {
    id: string;
    name: string;
    opponents: number;
    trophies: number;
}

export interface GarageDesign {
    bays: GarageBay[];
    customerCars: CustomerCar[];
    playerCar: PlayerCar;
    upgrades: UpgradeTrack[];
    races: RaceData[];
}

export const GARAGE: GarageDesign = data as GarageDesign;
