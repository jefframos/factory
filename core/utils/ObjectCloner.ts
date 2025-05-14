export default class ObjectCloner {
    static clone<T>(config: T, overrider?: T | any): T {
        if (overrider) {
            const clone = { ...config } as T;
            for (const key in overrider) {
                if (overrider[key] !== undefined) {
                    clone[key] = overrider[key];
                }
            }

            return clone as T;
        }
        return { ...config } as T
    }
}