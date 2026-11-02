import * as THREE from 'three';

/** A fitted, open-front coronation mantle that follows the character's chest rig. */
export function createRoyalMantle(chest: THREE.Bone) {
	const group = new THREE.Group();
	group.name = 'Royal coronation mantle';
	group.quaternion.copy(chest.getWorldQuaternion(new THREE.Quaternion()).invert());
	chest.add(group);
	const geometries = new Set<THREE.BufferGeometry>();
	const velvet = new THREE.MeshPhysicalMaterial({
		color: '#740e2a',
		roughness: 0.93,
		sheen: 0.85,
		sheenColor: '#b8435b',
		sheenRoughness: 0.8,
		side: THREE.FrontSide
	});
	const lining = new THREE.MeshStandardMaterial({ color: '#b48b4d', roughness: 0.85, side: THREE.BackSide });
	const fur = new THREE.MeshStandardMaterial({ color: '#eee6cf', roughness: 1, side: THREE.DoubleSide });
	const gold = new THREE.MeshStandardMaterial({ color: '#d5a64d', metalness: 0.78, roughness: 0.32 });
	const ermine = new THREE.MeshStandardMaterial({ color: '#302721', roughness: 1 });
	const ruby = new THREE.MeshPhysicalMaterial({
		color: '#a00c32',
		metalness: 0.3,
		roughness: 0.15,
		clearcoat: 1
	});
	const materials = [velvet, lining, fur, gold, ermine, ruby];
	// A subtle woven surface preserves the fabric detail without another texture download.
	velvet.onBeforeCompile = (shader) => {
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			`
			#include <color_fragment>
			float weave = sin(vViewPosition.x * 1800.0) * sin(vViewPosition.y * 1800.0);
			diffuseColor.rgb *= 0.97 + weave * 0.03;
		`
		);
	};
	function add(geometry: THREE.BufferGeometry, material: THREE.Material) {
		geometries.add(geometry);
		const part = new THREE.Mesh(geometry, material);
		group.add(part);
		return part;
	}
	function point(u: number, t: number, offset = 0) {
		// Keep the collar and upper drape behind the sleeves, then let the
		// mantle wrap forward below the elbows into its full, open-front hem.
		const drape = THREE.MathUtils.smoothstep(t, 0.16, 0.55);
		const opening = THREE.MathUtils.lerp(1.95, 0.57, drape);
		const angle = opening + u * (Math.PI * 2 - opening * 2);
		const fold = Math.sin(u * Math.PI * 24) * (0.006 + t * 0.022);
		const radius = 0.31 + Math.sin((t * Math.PI) / 2) * 0.13 + fold + offset;
		return new THREE.Vector3(
			Math.sin(angle) * radius,
			0.145 - t * 0.87 - Math.cos(angle) * 0.025 + Math.sin(u * Math.PI * 12) * t * 0.012,
			Math.cos(angle) * (0.19 + t * 0.09 + fold + offset) - 0.055 - (1 - drape) * 0.035
		);
	}
	function surface(start: number, end: number, offset = 0) {
		const columns = 128,
			rows = 40;
		const vertices: number[] = [],
			indices: number[] = [];
		for (let y = 0; y <= rows; y++)
			for (let x = 0; x <= columns; x++)
				vertices.push(...point(x / columns, start + ((end - start) * y) / rows, offset).toArray());
		for (let y = 0; y < rows; y++)
			for (let x = 0; x < columns; x++) {
				const a = y * (columns + 1) + x,
					b = a + columns + 1;
				indices.push(a, b, a + 1, a + 1, b, b + 1);
			}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();
		return geometry;
	}
	function stitch(points: THREE.Vector3[], radius = 0.004, material: THREE.Material = gold) {
		return add(
			new THREE.TubeGeometry(
				new THREE.CatmullRomCurve3(points),
				Math.max(16, points.length * 3),
				radius,
				6,
				false
			),
			material
		);
	}
	const cape = surface(0, 1);
	add(cape, velvet);
	add(cape, lining);
	// One continuous shoulder collar and hem, rather than separate fur balls.
	add(surface(-0.035, 0.14, 0.016), fur);
	add(surface(0.92, 1.015, 0.007), fur);
	for (const u of [0, 1]) {
		stitch(
			Array.from({ length: 35 }, (_, i) => point(u, i / 34, 0.008)),
			0.008
		);
		stitch(
			Array.from({ length: 35 }, (_, i) => point(u === 0 ? 0.022 : 0.978, 0.16 + (i / 34) * 0.75, 0.008))
		);
	}
	// Dark ermine tails and fine gold embroidery make the trim readable at small sizes.
	for (let i = 0; i < 23; i++) {
		const u = (i + 0.5) / 23;
		for (const t of [0.04, 0.975]) {
			const p = point(u, t, 0.023);
			stitch(
				[
					p.clone().add(new THREE.Vector3(-0.003, 0.008, 0)),
					p,
					p.clone().add(new THREE.Vector3(0.002, -0.01, 0))
				],
				0.0028,
				ermine
			);
		}
	}
	for (const edge of [0.05, 0.95])
		for (let i = 0; i < 6; i++) {
			const t = 0.23 + i * 0.11;
			stitch(
				[
					point(edge, t - 0.026, 0.012),
					point(edge + 0.017, t, 0.012),
					point(edge, t + 0.026, 0.012),
					point(edge - 0.017, t, 0.012),
					point(edge, t - 0.026, 0.012)
				],
				0.003
			);
		}
	// A draped chain closes the mantle across the chest; each link is articulated geometry.
	for (let i = 0; i <= 28; i++) {
		const x = -0.18 + (i / 28) * 0.36;
		const link = add(new THREE.TorusGeometry(0.009, 0.0028, 6, 16), gold);
		link.position.set(x, 0.065 - Math.cos(((x / 0.18) * Math.PI) / 2) * 0.09, 0.167);
		link.rotation.y = i % 2 ? Math.PI / 3 : 0;
	}
	const setting = add(new THREE.IcosahedronGeometry(0.033, 2), gold);
	setting.position.set(0, -0.026, 0.175);
	setting.scale.set(0.82, 1.1, 0.3);
	const jewel = add(new THREE.IcosahedronGeometry(0.024, 1), ruby);
	jewel.position.set(0, -0.026, 0.185);
	jewel.scale.set(0.8, 1.1, 0.35);
	return {
		dispose() {
			group.removeFromParent();
			geometries.forEach((geometry) => geometry.dispose());
			materials.forEach((material) => material.dispose());
		}
	};
}
