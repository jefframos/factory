export class ClassRegistry {
    private static classes: Map<string, new (...args: any[]) => any> = new Map();

    public static register<T>(className: string, classRef: new (...args: any[]) => T): void {
        this.classes.set(className, classRef);
    }

    public static get<T>(className: string): (new (...args: any[]) => T) | undefined {
        return this.classes.get(className) as (new (...args: any[]) => T) | undefined;
    }
}