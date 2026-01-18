import { Signal } from 'signals';

export class Observable {
    private _value: number = 0;
    public readonly onChange: Signal = new Signal(); // args: (oldValue: number, newValue: number)

    constructor(initialValue = 0) {
        this._value = initialValue;
    }

    public get value(): number {
        return this._value;
    }

    public set value(newValue: number) {
        const clamped = Math.max(0, newValue);
        if (clamped !== this._value) {
            const old = this._value;
            this._value = clamped;
            this.onChange.dispatch(old, clamped);
        }
    }

    public update(delta: number): void {
        this.value = this._value + delta;
    }

    public dispose(): void {
        this.onChange.removeAll();
    }

    public toJSON(): number {
        return this._value;
    }

    public fromJSON(value: number): void {
        this._value = Math.max(0, value);
    }
}
