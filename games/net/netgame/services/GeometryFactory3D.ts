import * as THREE from 'three';

export class GeometryFactory3D {
    /**
     * Creates a box. If smooth is true, it uses an extruded rounded rect.
     */
    public static createBox(w: number, h: number, depth: number, isSmooth: boolean): THREE.BufferGeometry {
        if (!isSmooth) {
            return new THREE.BoxGeometry(w, h, depth, Math.max(1, w / 50), Math.max(1, h / 50), 1);
        }

        const radius = Math.min(w, h) * 0.15; // 15% rounding
        const shape = new THREE.Shape();
        const x = -w / 2, y = -h / 2;

        shape.moveTo(x, y + radius);
        shape.lineTo(x, y + h - radius);
        shape.quadraticCurveTo(x, y + h, x + radius, y + h);
        shape.lineTo(x + w - radius, y + h);
        shape.quadraticCurveTo(x + w, y + h, x + w, y + h - radius);
        shape.lineTo(x + w, y + radius);
        shape.quadraticCurveTo(x + w, y, x + w - radius, y);
        shape.lineTo(x + radius, y);
        shape.quadraticCurveTo(x, y, x, y + radius);

        return new THREE.ExtrudeGeometry(shape, {
            depth: depth,
            bevelEnabled: true,
            bevelThickness: 4,
            bevelSize: 2,
            bevelSegments: 3
        }).translate(0, 0, -depth / 2);
    }

    /**
     * Creates a circle. Smooth uses CapsuleGeometry, Sharp uses Cylinder.
     */
    public static createCircle(radius: number, depth: number, isSmooth: boolean): THREE.BufferGeometry {
        let geo: THREE.BufferGeometry;
        if (isSmooth) {
            geo = new THREE.CapsuleGeometry(radius, depth - (radius * 0.5), 10, 64);
        } else {
            geo = new THREE.CylinderGeometry(radius, radius, depth, 64, 1);
        }
        geo.computeVertexNormals();
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
            depth,
            steps: 1,
            bevelEnabled: true,
            bevelThickness: 2,
            bevelSize: 2,
            bevelSegments: 3
        }).translate(0, 0, -depth / 2);
    }
}