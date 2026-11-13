// MarketLayout.ts
//
// The supermarket's layout: levels/market.json, in core/rooms' format like the restaurant's (edited in the same editor,
// `npm run editor`, Level: Supermarket): its floors, walls and props (fridges, shelves...). One stage. Plus the
// market's own `market`:
//   - `crates`: the produce crates' grid — its middle (x, z), how many columns, the gaps between crates (x, and z: room
//     for the name tags). Which crate goes where is shuffled each visit;
//   - `cashier`: where the cashier stands (x, z), faces (rotationY) and how big they are (scale, 1: a customer's size).

import layoutJson from '../../levels/market.json';
import { Room, RoomLayout } from 'core/rooms/Room';
import { kitchenModel } from './Models';

export interface MarketLayout extends RoomLayout {
    name: string;
    market: {
        crates: { x: number; z: number; columns: number; gapX: number; gapZ: number };
        cashier: { x: number; z: number; rotationY?: number; scale?: number };
    };
}

export const MARKET_LAYOUT = layoutJson as unknown as MarketLayout;

/** The models the market's props use (to load before building it). */
export const marketRoomModels = (): string[] => [...new Set(MARKET_LAYOUT.props.map((p) => p.model))];

/** The market's room (its models loaded: marketRoomModels). */
export const buildMarketRoom = (): Room => new Room(MARKET_LAYOUT, 0, { instantiate: (model) => kitchenModel(model) });
