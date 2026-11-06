// Shared world layout and player classes for Ghost Hunt

export const BOUNDS = 11.5; // inside the walls

// Furniture that players and the ghost cannot walk through
export const OBSTACLES = [
    { minX: -6, maxX: -4, minZ: -6, maxZ: -2 },    // cabinet
    { minX: 3, maxX: 6, minZ: 2, maxZ: 3.5 },      // table
    { minX: -1, maxX: 1, minZ: 4, maxZ: 6 },       // crates
    { minX: 7, maxX: 8.5, minZ: -7, maxZ: -4 }     // wardrobe
];

// Keeps a point inside the house walls (ignores furniture)
export function clampBounds(x, z, r = 0.4) {
    return {
        x: Math.max(-BOUNDS + r, Math.min(BOUNDS - r, x)),
        z: Math.max(-BOUNDS + r, Math.min(BOUNDS - r, z))
    };
}

// Keeps a point inside the walls and pushes it out of furniture
export function clampToWorld(x, z, r = 0.4) {
    const p = clampBounds(x, z, r);
    x = p.x;
    z = p.z;
    for (const o of OBSTACLES) {
        const minX = o.minX - r, maxX = o.maxX + r;
        const minZ = o.minZ - r, maxZ = o.maxZ + r;
        if (x > minX && x < maxX && z > minZ && z < maxZ) {
            const left = x - minX, right = maxX - x;
            const near = z - minZ, far = maxZ - z;
            const m = Math.min(left, right, near, far);
            if (m === left) x = minX;
            else if (m === right) x = maxX;
            else if (m === near) z = minZ;
            else z = maxZ;
        }
    }
    return { x, z };
}

// ---------- Local player (you) ----------
export class LocalPlayer {
    constructor(camera) {
        this.camera = camera;
        this.pos = new THREE.Vector3(0, 1.6, 9);
        this.yaw = 0;
        this.pitch = 0;
        this.sanity = 100;
        this.dead = false;
        this.flashOn = true;

        // Flashlight attached to the camera
        this.spot = new THREE.SpotLight(0xfff2cc, 2.5, 26, 0.38, 0.4, 1.2);
        this.spot.position.set(0.2, -0.2, 0);
        this.spot.target.position.set(0, 0, -1);
        camera.add(this.spot);
        camera.add(this.spot.target);
    }

    reset(x, z) {
        this.pos.set(x, 1.6, z);
        this.yaw = 0;
        this.pitch = 0;
        this.sanity = 100;
        this.dead = false;
        this.flashOn = true;
        this.spot.visible = true;
    }

    look(dx, dy) {
        this.yaw -= dx * 0.0025;
        this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * 0.0025));
    }

    update(dt, keys) {
        if (this.dead) {
            this.camera.position.set(this.pos.x, 0.35, this.pos.z);
            this.camera.rotation.set(-1.35, this.yaw, 0, 'YXZ');
            return;
        }

        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        let mx = 0, mz = 0;
        if (keys.KeyW || keys.ArrowUp)    { mx += fx; mz += fz; }
        if (keys.KeyS || keys.ArrowDown)  { mx -= fx; mz -= fz; }
        if (keys.KeyA || keys.ArrowLeft)  { mx -= rx; mz -= rz; }
        if (keys.KeyD || keys.ArrowRight) { mx += rx; mz += rz; }

        const len = Math.hypot(mx, mz);
        if (len > 0) {
            const running = keys.ShiftLeft || keys.ShiftRight;
            const speed = running ? 4.6 : 2.8;
            const p = clampToWorld(
                this.pos.x + (mx / len) * speed * dt,
                this.pos.z + (mz / len) * speed * dt,
                0.45
            );
            this.pos.x = p.x;
            this.pos.z = p.z;
        }

        this.camera.position.set(this.pos.x, this.pos.y, this.pos.z);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    // True if the flashlight beam is pointing at a point in the world
    canSee(point) {
        if (!this.flashOn || this.dead) return false;
        const dir = new THREE.Vector3().subVectors(point, this.camera.position);
        const dist = dir.length();
        if (dist > 24) return false;
        dir.divideScalar(dist);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        return forward.dot(dir) > Math.cos(0.4);
    }
}

// ---------- Other players ----------
export class RemotePlayer {
    constructor(scene, name, color) {
        this.scene = scene;
        this.group = new THREE.Group();

        const body = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.35, 1.4, 12),
            new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
        );
        body.position.y = 0.9;

        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.26, 14, 12),
            new THREE.MeshStandardMaterial({ color: 0xd9b08c })
        );
        head.position.y = 1.8;

        this.group.add(body, head, makeNameLabel(name));
        scene.add(this.group);

        this.target = new THREE.Vector3();
        this.yaw = 0;
        this.targetYaw = 0;
        this.dead = false;
    }

    setState(s) {
        this.target.set(s.x, 0, s.z);
        this.targetYaw = s.yaw;
        this.dead = !!s.dead;
    }

    update(dt) {
        const k = Math.min(1, dt * 10);
        this.group.position.lerp(this.target, k);

        let d = this.targetYaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * k;
        this.group.rotation.y = this.yaw;
        this.group.rotation.x = this.dead ? -Math.PI / 2 : 0;
    }

    remove() {
        this.scene.remove(this.group);
    }
}

function makeNameLabel(text) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#ffffff';
    g.font = 'bold 28px Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(text).slice(0, 14), 128, 32);

    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
    );
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.y = 2.3;
    return sprite;
}