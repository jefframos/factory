export interface TriggerAction {
    description?: string;
    onEnter?: (triggerId: string, source: any) => void;
    onStay?: (triggerId: string, source: any) => void;
    onExit?: (triggerId: string, source: any) => void;
}
