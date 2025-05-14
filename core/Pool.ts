type Constructor<T> = new () => T;

export default class Pool {
    private static _instance: Pool;
    public static Debug = false;

    public static get instance(): Pool {
        if (!Pool._instance) {
            Pool._instance = new Pool();
        }
        return Pool._instance;
    }

    private pool: Record<string, unknown[]> = {};

    private constructor() { }


    public getElement<T>(ctor: Constructor<T>): T {
        const key = ctor.name;
        const bucket = (this.pool[key] ||= []) as T[];

        if (bucket.length > 0) {
            return bucket.shift()!;
        }

        const newElement = new ctor();
        if (Pool.Debug && typeof (newElement as any).setDebug === 'function') {
            (newElement as any).setDebug();
        }
        return newElement;
    }


    public returnElement<T extends { constructor: { name: string } }>(element: T): void {
        const key = element.constructor.name;
        const bucket = (this.pool[key] ||= []) as T[];
        bucket.push(element);
    }


    public getPool<T>(ctor: Constructor<T>): T[] {
        const key = ctor.name;
        return ((this.pool[key] as T[]) ?? []).slice(); // return a copy
    }
}
