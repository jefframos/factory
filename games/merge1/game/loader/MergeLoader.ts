import LoaderScene from "@core/loader/LoaderScene";
import { NineSliceProgressBarAsync } from "@core/ui/NineSliceProgressBarAsync";
import PatternBackground from "@core/ui/PatternBackground";

export default class MergeLoader extends LoaderScene {
    private patternBg!: PatternBackground;
    private progress!: NineSliceProgressBarAsync

    public async build() {
        // Create the component
        this.patternBg = new PatternBackground({ background: 0x26C6DA, patternPath: 'game4/images/non-preload/jiggy-pattern.png', patternAlpha: 0.2 });
        this.addChild(this.patternBg);


        this.progress = new NineSliceProgressBarAsync({
            width: 300,
            height: 40,
            bgPath: 'game4/images/non-preload/bg_loader.png',
            barPath: 'game4/images/non-preload/fill_loader.png',
            slices: [10, 10, 10, 10],
            barColor: 0xffffff, // Tint the white texture green
            padding: 4
        });


        this.addChild(this.progress);
        // Start the async load
        await this.patternBg.init();

        // Build UI on top
        //super.build();
    }
    public updateLoader(percent: number) {
        this.progress.update(percent);
    }
    public update(delta: number) {
        super.update(delta);

        // Update the component
        if (this.patternBg) {
            this.patternBg.update(delta);
        }
    }
}