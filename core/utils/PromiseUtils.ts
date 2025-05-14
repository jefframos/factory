export default class PromiseUtils {
    static await(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}