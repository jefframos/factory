export function getStaticProgressionData(): Record<string, {
    name: string;
    maxLevel?: number;
    upgradeThreshold?: number | number[];
    unlockConditions: (
        | { type: 'areaLevel'; areaId: string; level: number }
        | { type: 'actionsCompleted'; areaId: string; count: number }
        | { type: 'areaMaxed'; areaId: string }
    )[];
}> {
    return {
        upgrade1: {
            name: "Kitchen",
            maxLevel: 3,
            upgradeThreshold: [50, 100, 150],
            unlockConditions: []
        },
        upgrade2: {
            name: "Coffee Bar",
            maxLevel: 3,
            upgradeThreshold: [50, 100, 150],
            unlockConditions: [
                { type: "areaLevel", areaId: "upgrade1", level: 1 }
            ]
        },
        pastry_station: {
            name: "Pastry Station",
            maxLevel: 2,
            unlockConditions: [
                { type: "areaLevel", areaId: "upgrade1", level: 3 }
            ]
        },
        rooftop: {
            name: "Rooftop Lounge",
            maxLevel: 1,
            unlockConditions: [
                { type: "actionsCompleted", areaId: "upgrade2", count: 50 }
            ]
        },
        vip_room: {
            name: "VIP Room",
            maxLevel: 1,
            unlockConditions: [
                { type: "areaMaxed", areaId: "upgrade1" },
                { type: "actionsCompleted", areaId: "upgrade2", count: 20 }
            ]
        }
    };
}
