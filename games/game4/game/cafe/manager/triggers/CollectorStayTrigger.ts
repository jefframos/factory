
import { Game } from '@core/Game';
import { UpgradeTrigger } from './UpgradeTrigger';
export default class CollectorStayTrigger extends UpgradeTrigger {
    protected onStay() {

        this.timer += Game.deltaTime;
        const time = 0.5
        while (this.timer >= time) {
            this.onUpgrade.dispatch(this.id, 1);
            this.timer -= time;
        }


    };

}