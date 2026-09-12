import { TailCube } from "./TailCube";
import * as THREE from "three";
import { CubeBuilder } from "../builders/CubeBuilder";
import { sizeForValue } from "../ClogConstants";
import { BlobShadow } from "./BlobShadow";
import { FloatBob } from "../components/FloatBob";

export class MultiplierCube extends TailCube {

    private stPos: THREE.Vector3 = new THREE.Vector3();
    private elapsedTime = 0;

    override build(value: number, scene: THREE.Scene, position?: THREE.Vector3) {
        this.isMultiplier = true;

        this.value = value;
        this.mesh = CubeBuilder.buildMultiplier(2, 2, {
            bodyColor: "#ff00f7",
            textColor: "#fffa5f"
        });
        this.transform = new THREE.Group();
        this.transform.add(this.mesh);
        if (position) this.transform.position.copy(position);
        scene.add(this.transform);
        this.applyScale();
        this.shadow = new BlobShadow(scene);
        this.shadow.update(this.transform.position.x, this.transform.position.z, sizeForValue(value));
        this.floatBob = new FloatBob(Math.random() * Math.PI * 2);


        this.stPos = new THREE.Vector3();
        this.stPos.copy(this.transform.position)
    }

    protected applyScale(): void {
        const s = sizeForValue(this.value);
        this.mesh.scale.setScalar(s);
        this.mesh.position.y = s * 0.5;
    }
    update(delta: number): void {
        super.update(delta);

        this.elapsedTime += delta;

        this.transform.rotateY(delta * 1.5)

        this.transform.position.y = this.stPos.y * Math.cos(this.elapsedTime * 20) * 0.5 + 0.5
    }
}