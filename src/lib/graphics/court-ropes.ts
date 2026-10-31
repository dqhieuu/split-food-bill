import * as THREE from 'three';

export type Rope = { start: [number, number]; end: [number, number] };

// The camera uses CSS-pixel coordinates so these lit meshes follow the figure hands.
export function createCourtRopes(canvas: HTMLCanvasElement, onfailure: () => void) {
	const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
	renderer.setClearColor(0, 0);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	const scene = new THREE.Scene();
	const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 1000);
	camera.position.z = 500;
	scene.add(new THREE.HemisphereLight('#fff0d2', '#382536', 2));
	const light = new THREE.DirectionalLight('#fff3d8', 3);
	light.position.set(-100, 400, 500);
	scene.add(light);
	const material = new THREE.MeshStandardMaterial({ color: '#b78c59', roughness: 0.9 });
	const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
	const segments = 96,
		sides = 6;
	let lastWidth = 0,
		lastHeight = 0;
	function makeStrand() {
		const geometry = new THREE.BufferGeometry();
		const positions = new Float32Array((segments + 1) * (sides + 1) * 3);
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
		);
		geometry.setAttribute(
			'normal',
			new THREE.BufferAttribute(new Float32Array(positions.length), 3).setUsage(THREE.DynamicDrawUsage)
		);
		const indices = [];
		for (let i = 0; i < segments; i++)
			for (let j = 0; j < sides; j++) {
				const a = i * (sides + 1) + j,
					b = a + sides + 1;
				indices.push(a, a + 1, b, b, a + 1, b + 1);
			}
		geometry.setIndex(indices);
		const mesh = new THREE.Mesh(geometry, material);
		mesh.frustumCulled = false;
		scene.add(mesh);
		meshes.push(mesh);
		return mesh;
	}
	function update(ropes: Rope[], width: number, height: number) {
		if (!width || !height) return;
		if (width !== lastWidth || height !== lastHeight) {
			lastWidth = width;
			lastHeight = height;
			renderer.setSize(width, height, false);
			camera.right = width;
			camera.top = height;
			camera.updateProjectionMatrix();
		}
		while (meshes.length < ropes.length * 3) makeStrand();
		meshes.forEach((mesh, i) => (mesh.visible = i < ropes.length * 3));
		ropes.forEach(({ start: [x, y], end: [endX, endY] }, index) => {
			const curve = new THREE.CubicBezierCurve3(
				new THREE.Vector3(x, height - y, 0),
				new THREE.Vector3(Math.min(width - 12, x + 100), height - y - 100, 24),
				new THREE.Vector3(Math.min(width - 12, endX + 65), height - endY - 30, -16),
				new THREE.Vector3(endX, height - endY, 0)
			);
			const turns = curve.getLength() / 15;
			for (let strand = 0; strand < 3; strand++) {
				const geometry = meshes[index * 3 + strand].geometry;
				const position = geometry.getAttribute('position') as THREE.BufferAttribute;
				const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
				for (let i = 0; i <= segments; i++) {
					const t = i / segments,
						point = curve.getPoint(t),
						tangent = curve.getTangent(t);
					const side = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();
					const depth = new THREE.Vector3().crossVectors(tangent, side).normalize();
					const twist = t * turns * Math.PI * 2 + (strand * Math.PI * 2) / 3;
					const center = point
						.clone()
						.addScaledVector(side, Math.cos(twist) * 1.05)
						.addScaledVector(depth, Math.sin(twist) * 1.05);
					for (let j = 0; j <= sides; j++) {
						const angle = (j / sides) * Math.PI * 2;
						const outward = side
							.clone()
							.multiplyScalar(Math.cos(angle))
							.addScaledVector(depth, Math.sin(angle));
						const p = center.clone().addScaledVector(outward, 0.85),
							vertex = i * (sides + 1) + j;
						position.setXYZ(vertex, p.x, p.y, p.z);
						normal.setXYZ(vertex, outward.x, outward.y, outward.z);
					}
				}
				position.needsUpdate = normal.needsUpdate = true;
			}
		});
		renderer.render(scene, camera);
		if (canvas.dataset.renderer !== '3d') canvas.dataset.renderer = '3d';
		if (canvas.dataset.ropes !== String(ropes.length)) canvas.dataset.ropes = String(ropes.length);
	}
	canvas.addEventListener('webglcontextlost', onfailure);
	return {
		update,
		dispose() {
			canvas.removeEventListener('webglcontextlost', onfailure);
			meshes.forEach((mesh) => mesh.geometry.dispose());
			material.dispose();
			scene.clear();
			renderer.dispose();
		}
	};
}
