import * as THREE from 'three';

export class GeometryFactory3D {
    /**
     * Creates a box. If smooth is true, it uses an extruded rounded rect.
     */
    public static createSubdividedBox(w: number, h: number, d: number, subdivisions: number = 40): THREE.BufferGeometry {
        // BoxGeometry(width, height, depth, widthSegments, heightSegments, depthSegments)
        // We subdivide the X and Y heavily because your shader bends those axes.
        const geometry = new THREE.BoxGeometry(
            w, h, d,
            subdivisions, // Internal points along X
            subdivisions, // Internal points along Y
            1             // We usually don't need to bend the Z thickness for 2D-style play
        );

        return geometry;
    }

    public static createBox(w: number, h: number, depth: number, isSmooth: boolean): THREE.BufferGeometry {
        // 1. We ALWAYS use BoxGeometry to ensure we have a grid for the Bend Shader
        const segmentsW = Math.max(30, Math.floor(w / 10));
        const segmentsH = Math.max(30, Math.floor(h / 10));

        const geo = new THREE.BoxGeometry(w, h, depth, segmentsW, segmentsH, 1);

        if (isSmooth) {
            const radius = Math.min(w, h) * 0.15;
            const pos = geo.attributes.position;
            const vec = new THREE.Vector3();

            // 2. "Round" the vertices manually
            // This keeps the internal grid intact but curves the outer edges
            for (let i = 0; i < pos.count; i++) {
                vec.fromBufferAttribute(pos, i);

                // Calculate how far the vertex is from the center "core" of the box
                const coreW = (w / 2) - radius;
                const coreH = (h / 2) - radius;

                const dx = Math.max(0, Math.abs(vec.x) - coreW);
                const dy = Math.max(0, Math.abs(vec.y) - coreH);

                if (dx > 0 && dy > 0) {
                    // We are in a corner region - project onto a circle
                    const angle = Math.atan2(dy, dx);
                    vec.x = Math.sign(vec.x) * (coreW + Math.cos(angle) * radius);
                    vec.y = Math.sign(vec.y) * (coreH + Math.sin(angle) * radius);
                    pos.setXY(i, vec.x, vec.y);
                }
            }
            pos.needsUpdate = true;
        }

        geo.computeVertexNormals();
        return geo;
    }
    private static finalize(geo: THREE.BufferGeometry) {
        geo.computeVertexNormals();
        return geo;
    }
    /**
     * Creates a circle. Smooth uses CapsuleGeometry, Sharp uses Cylinder.
     */
    public static createCircle(radius: number, depth: number, isSmooth: boolean): THREE.BufferGeometry {
        // 1. Create the "Polygon" (a circular shape)
        const shape = new THREE.Shape();
        shape.absarc(0, 0, radius, 0, Math.PI * 2, false);

        let geo: THREE.BufferGeometry;

        if (isSmooth) {
            // 2. Extrude with Bevel for the "Smooth" look
            // The bevel gives those rounded edges you're looking for
            const extrudeSettings = {
                depth: depth,
                bevelEnabled: true,
                bevelSegments: 3,     // How many steps in the curve
                steps: 1,
                bevelSize: radius * 0.05,    // How far out the bevel goes
                bevelThickness: radius * 0.05, // How "deep" the rounding is
                curveSegments: 64     // The smoothness of the circle itself
            };

            geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

            // Center the geometry since Extrude starts from Z=0
            geo.center();
            geo.rotateX(Math.PI / 2);
        } else {
            // 3. Standard Cylinder for the "Hard" look
            geo = new THREE.CylinderGeometry(radius, radius, depth, 64, 1);
        }

        geo.computeVertexNormals();

        // Rotate to match your previous orientation (lying on the Z axis)
        return geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    }

    /**
     * Creates a polygon with optional filleted corners.
     */
    public static createPolygon(vertices: { x: number, y: number }[], depth: number, isSmooth: boolean): THREE.BufferGeometry {
        const shape = new THREE.Shape();
        const radius = isSmooth ? 15 : 0;
        const len = vertices.length;

        if (!isSmooth) {
            shape.moveTo(vertices[0].x, -vertices[0].y);
            for (let i = 1; i < len; i++) shape.lineTo(vertices[i].x, -vertices[i].y);
        } else {
            // Rounded corner logic
            for (let i = 0; i < len; i++) {
                const p1 = vertices[i];
                const p2 = vertices[(i + 1) % len];
                const p3 = vertices[(i + 2) % len];

                const v1x = p1.x - p2.x, v1y = -p1.y - (-p2.y);
                const v2x = p3.x - p2.x, v2y = -p3.y - (-p2.y);
                const d1 = Math.sqrt(v1x * v1x + v1y * v1y), d2 = Math.sqrt(v2x * v2x + v2y * v2y);
                const r = Math.min(radius, d1 / 2, d2 / 2);

                const startX = p2.x + (v1x / d1) * r, startY = -p2.y + (v1y / d1) * r;
                const endX = p2.x + (v2x / d2) * r, endY = -p2.y + (v2y / d2) * r;

                if (i === 0) shape.moveTo(startX, startY);
                else shape.lineTo(startX, startY);
                shape.quadraticCurveTo(p2.x, -p2.y, endX, endY);
            }
        }
        shape.closePath();

        return new THREE.ExtrudeGeometry(shape, {
            depth: depth + 0.001,
            steps: 1, // Increase this to allow the "sides" to bend smoothly
            curveSegments: 32, // Ensures the rounded corners have enough vertices
            bevelEnabled: true,
            bevelThickness: 2,
            bevelSize: 2,
            bevelSegments: 3
        }).translate(0, 0, -depth / 2);
    }
}