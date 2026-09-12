import * as THREE from 'three';

export class CartoonSky {
    public readonly container = new THREE.Group();

    private readonly skyContainer = new THREE.Group();
    private readonly cloudContainer = new THREE.Group();

    private readonly clouds: THREE.Group[] = [];

    /**
     * Degrees above the mathematical horizon.
     *
     * 0   = directly on the horizon
     * 5   = slightly above it
     * 15  = noticeably higher in the sky
     * -5  = slightly below the horizon
     */
    private cloudBaselineDeg = 5;

    /**
     * Distance between the camera and the clouds.
     * Keep this below the camera far clipping distance.
     */
    private cloudDistance = 220;

    /**
     * The horizontal angles around the camera where clouds appear.
     *
     * 0 degrees is directly ahead.
     * Negative values are left.
     * Positive values are right.
     */
    private readonly cloudAzimuthsDeg = [
        -65,
        -35,
        -10,
        20,
        50,
        75,
    ];

    public constructor(scene: THREE.Scene) {
        this.container.add(this.skyContainer);
        this.container.add(this.cloudContainer);

        this.createSkyDome();
        this.createClouds();

        scene.add(this.container);
    }

    private createSkyDome(): void {
        const geometry = new THREE.SphereGeometry(500, 32, 16);

        const material = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,

            uniforms: {
                topColor: {
                    value: new THREE.Color(0x168cff),
                },
                horizonColor: {
                    value: new THREE.Color(0x7deaff),
                },
                bottomColor: {
                    value: new THREE.Color(0xbff8ff),
                },
            },

            vertexShader: `
                varying vec3 vLocalPosition;

                void main() {
                    vLocalPosition = position;

                    gl_Position =
                        projectionMatrix *
                        modelViewMatrix *
                        vec4(position, 1.0);
                }
            `,

            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 horizonColor;
                uniform vec3 bottomColor;

                varying vec3 vLocalPosition;

                void main() {
                    vec3 direction = normalize(vLocalPosition);

                    float height = direction.y * 0.5 + 0.5;

                    vec3 color;

                    if (height < 0.5) {
                        color = mix(
                            bottomColor,
                            horizonColor,
                            smoothstep(0.0, 0.5, height)
                        );
                    } else {
                        color = mix(
                            horizonColor,
                            topColor,
                            smoothstep(0.5, 1.0, height)
                        );
                    }

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
        });

        const sky = new THREE.Mesh(geometry, material);

        sky.frustumCulled = false;
        sky.renderOrder = -1000;

        this.skyContainer.add(sky);
    }

    private createClouds(): void {
        const material = new THREE.MeshToonMaterial({
            color: 0xffffff,
            depthWrite: true,
        });

        const scales = [
            1.15,
            0.8,
            1.35,
            0.7,
            1,
            0.65,
        ];

        for (let index = 0; index < this.cloudAzimuthsDeg.length; index++) {
            const cloud = this.createCloud(material);

            cloud.scale.setScalar(scales[index] ?? 1);

            this.cloudContainer.add(cloud);
            this.clouds.push(cloud);
        }

        this.updateCloudLayout();
    }

    private createCloud(material: THREE.Material): THREE.Group {
        const cloud = new THREE.Group();

        const geometry = new THREE.SphereGeometry(10, 16, 10);

        const parts = [
            {
                position: [-16, 0, 0],
                scale: [1.2, 0.65, 0.65],
            },
            {
                position: [-7, 4, 0],
                scale: [1.25, 0.9, 0.8],
            },
            {
                position: [3, 7, 0],
                scale: [1.4, 1.1, 0.9],
            },
            {
                position: [14, 2, 0],
                scale: [1.25, 0.75, 0.7],
            },
            {
                position: [23, -1, 0],
                scale: [0.9, 0.55, 0.6],
            },
        ];

        for (const part of parts) {
            const mesh = new THREE.Mesh(geometry, material);

            mesh.position.set(
                part.position[0],
                part.position[1],
                part.position[2],
            );

            mesh.scale.set(
                part.scale[0],
                part.scale[1],
                part.scale[2],
            );

            mesh.castShadow = false;
            mesh.receiveShadow = false;

            cloud.add(mesh);
        }

        return cloud;
    }

    /**
     * Change the vertical cloud baseline.
     *
     * Example:
     * cartoonSky.setCloudBaseline(2);
     */
    public setCloudBaseline(degrees: number): void {
        this.cloudBaselineDeg = degrees;
        this.updateCloudLayout();
    }

    public getCloudBaseline(): number {
        return this.cloudBaselineDeg;
    }

    public setCloudDistance(distance: number): void {
        this.cloudDistance = Math.max(1, distance);
        this.updateCloudLayout();
    }

    private updateCloudLayout(): void {
        const elevationRad = THREE.MathUtils.degToRad(
            this.cloudBaselineDeg,
        );

        const horizontalDistance =
            Math.cos(elevationRad) * this.cloudDistance;

        const verticalPosition =
            Math.sin(elevationRad) * this.cloudDistance;

        for (let index = 0; index < this.clouds.length; index++) {
            const cloud = this.clouds[index];
            const azimuthDeg = this.cloudAzimuthsDeg[index] ?? 0;
            const azimuthRad = THREE.MathUtils.degToRad(azimuthDeg);

            /*
             * In Three.js, the camera normally looks down its local -Z axis.
             */
            const x = Math.sin(azimuthRad) * horizontalDistance;
            const z = -Math.cos(azimuthRad) * horizontalDistance;

            cloud.position.set(
                x,
                verticalPosition,
                z,
            );

            /*
             * Make the broad front of the cloud face the centre.
             * update() will make it face the real camera.
             */
            cloud.lookAt(0, verticalPosition, 0);
        }
    }

    public update(
        deltaSeconds: number,
        camera: THREE.Camera,
    ): void {
        /*
         * Keep the complete sky system centred on the camera.
         */
        this.container.position.copy(camera.position);

        /*
         * Keep the cloud ring aligned with the camera's horizontal rotation.
         * This means "directly ahead" follows the camera.
         */
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);

        const cameraYaw = Math.atan2(
            cameraDirection.x,
            cameraDirection.z,
        );

        this.cloudContainer.rotation.y = cameraYaw + Math.PI;

        /*
         * Make each cloud face the camera.
         */
        const localCameraPosition = new THREE.Vector3();

        this.cloudContainer.worldToLocal(
            localCameraPosition.copy(camera.position),
        );

        for (let index = 0; index < this.clouds.length; index++) {
            const cloud = this.clouds[index];

            cloud.lookAt(
                localCameraPosition.x,
                cloud.position.y,
                localCameraPosition.z,
            );

            // Optional subtle movement.
            cloud.position.y +=
                Math.sin(performance.now() * 0.0002 + index) *
                deltaSeconds *
                0.15;
        }
    }
}