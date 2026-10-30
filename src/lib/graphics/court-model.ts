import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { CourtTier } from '$lib/domain/leaderboard';
import type { Member } from '$lib/domain/types';

export type CourtAppearance = {
	member: Pick<Member, 'id' | 'name' | 'color' | 'avatarUrl'>;
	tier: CourtTier;
};

type Point = [number, number, number];
type RenderState = { x: number; y: number; avatar: boolean };

// All figures share one WebGL context and a 30fps animation loop. Hidden and paused
// figures cost no animation frames; mobile browsers don't need six contexts.
let renderer: THREE.WebGLRenderer | undefined;
let clients = 0;
const animations = new Map<symbol, (time: number) => void>();
let animationFrame = 0;
let lastFrame = 0;
function animateFigures(time: number) {
	animationFrame = 0;
	if (time - lastFrame >= 1000 / 30) {
		lastFrame = time;
		animations.forEach((animate) => animate(time));
	}
	if (animations.size) animationFrame = requestAnimationFrame(animateFigures);
}
function setAnimation(key: symbol, animate?: (time: number) => void) {
	if (animate) animations.set(key, animate);
	else animations.delete(key);
	if (animations.size && !animationFrame) animationFrame = requestAnimationFrame(animateFigures);
	else if (!animations.size) {
		cancelAnimationFrame(animationFrame);
		animationFrame = 0;
	}
}

const templates = new Map<string, Promise<THREE.Group>>();
async function loadOutfit(royal: boolean) {
	const url = `/models/court/Male_${royal ? 'Ranger' : 'Peasant'}.gltf`;
	let pending = templates.get(url);
	if (!pending) {
		pending = new GLTFLoader()
			.loadAsync(url)
			.then((gltf) => gltf.scene)
			.catch((error) => {
				templates.delete(url);
				throw error;
			});
		templates.set(url, pending);
	}
	return clone(await pending) as THREE.Group;
}

export async function createCourtModel(
	canvas: HTMLCanvasElement,
	entry: CourtAppearance,
	onrender: (state: RenderState) => void,
	onfailure: () => void
) {
	const outfit = await loadOutfit(entry.tier === 'sovereign' || entry.tier === 'noble');
	const output = canvas.getContext('2d');
	if (!output) throw new Error('Canvas unavailable');
	if (!renderer) {
		renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
		renderer.setClearColor(0x000000, 0);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.35;
	}
	const engine = renderer;
	clients++;
	let disposed = false;
	let loadedAvatar = false;
	let lastRenderState = '';

	const scene = new THREE.Scene();
	const model = new THREE.Group();
	scene.add(model);
	// Match the sprite's occupied height and floor, including its shorter kneeling pose.
	const top = entry.tier === 'sovereign' ? 1.7 : entry.tier === 'servant' ? 1.6 : 1.98;
	const bottom = -0.06;
	const halfWidth = (top - bottom) / 3;
	const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, top, bottom, 0.1, 20);
	camera.position.set(0, 0, 6);
	camera.updateMatrixWorld();
	scene.add(new THREE.HemisphereLight('#fff1da', '#3b2945', 2.2));
	const key = new THREE.DirectionalLight('#fff0d8', 3.2);
	key.position.set(-3, 5, 5);
	scene.add(key);
	const rim = new THREE.DirectionalLight('#e1ac62', 2.5);
	rim.position.set(3, 2, -2);
	scene.add(rim);
	const materials: THREE.Material[] = [];
	const geometries: THREE.BufferGeometry[] = [];
	function material(color: string, metalness = 0, roughness = 0.65) {
		const result = new THREE.MeshStandardMaterial({ color, metalness, roughness });
		materials.push(result);
		return result;
	}
	const debtor = entry.tier === 'servant';
	const royal = entry.tier === 'sovereign' || entry.tier === 'noble';
	const skin = material('#d8aa85');
	const gold = material(royal ? '#dfb65f' : '#a29478', 0.72, 0.28);
	const rope = material('#d4ac72');
	const hair = material('#302622');
	function mesh(
		geometry: THREE.BufferGeometry,
		mat: THREE.Material,
		position: Point,
		scale: Point = [1, 1, 1],
		parent: THREE.Object3D = model
	) {
		geometries.push(geometry);
		const part = new THREE.Mesh(geometry, mat);
		part.position.set(...position);
		part.scale.set(...scale);
		parent.add(part);
		return part;
	}
	function oval(position: Point, scale: Point, mat: THREE.Material, parent: THREE.Object3D = model) {
		return mesh(new THREE.SphereGeometry(1, 64, 40), mat, position, scale, parent);
	}
	// The clothing and limbs are authored, skinned meshes, not disconnected primitives.
	model.add(outfit);
	const bones = new Map<string, THREE.Bone>();
	const skeletons = new Set<THREE.Skeleton>();
	outfit.traverse((object) => {
		if (object instanceof THREE.Bone) bones.set(object.name, object);
		if (!(object instanceof THREE.Mesh)) return;
		if (object.name.includes('Head_Hood')) object.visible = false;
		const source = Array.isArray(object.material) ? object.material : [object.material];
		const copies = source.map((original) => {
			const copy = original.clone() as THREE.MeshStandardMaterial;
			if (copy.name.includes('Ranger')) copy.color.set(entry.tier === 'sovereign' ? '#d8a49d' : '#b7a4d4');
			copy.roughness = 0.8;
			materials.push(copy);
			return copy;
		});
		object.material = Array.isArray(object.material) ? copies : copies[0];
		object.frustumCulled = false;
		if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
	});
	const bone = (name: string) => {
		const result = bones.get(name);
		if (!result) throw new Error(`Missing court rig joint: ${name}`);
		return result;
	};
	outfit.updateMatrixWorld(true);
	const bind = new Map(
		[...bones].map(([name, joint]) => [
			name,
			{ position: joint.position.clone(), rotation: joint.quaternion.clone() }
		])
	);
	const baseFoot = new Map(
		['l', 'r'].map((side) => [side, bone(`foot_${side}`).getWorldQuaternion(new THREE.Quaternion())])
	);
	const origin = bone('pelvis').position.clone();
	const seated = entry.tier === 'sovereign';
	const shadow = new THREE.MeshBasicMaterial({
		color: '#09060d',
		transparent: true,
		opacity: 0.4,
		depthWrite: false
	});
	materials.push(shadow);
	mesh(new THREE.CircleGeometry(1, 32), shadow, [0, 0.015, -0.2], [0.45, 0.035, 1]);
	function worldPoint(p: Point) {
		return model.localToWorld(new THREE.Vector3(...p));
	}
	function aim(joint: THREE.Bone, child: THREE.Bone, target: THREE.Vector3) {
		outfit.updateMatrixWorld(true);
		const position = joint.getWorldPosition(new THREE.Vector3());
		const current = child.getWorldPosition(new THREE.Vector3()).sub(position).normalize();
		const desired = target.clone().sub(position).normalize();
		const rotation = new THREE.Quaternion()
			.setFromUnitVectors(current, desired)
			.multiply(joint.getWorldQuaternion(new THREE.Quaternion()));
		const parent = joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
		joint.quaternion.copy(parent.multiply(rotation));
		outfit.updateMatrixWorld(true);
	}
	function solveLimb(upper: string, lower: string, tip: string, target: Point, pole: Point) {
		const a = bone(upper),
			b = bone(lower),
			c = bone(tip);
		const shoulder = a.getWorldPosition(new THREE.Vector3());
		const lengthA = shoulder.distanceTo(b.getWorldPosition(new THREE.Vector3()));
		const lengthB = b
			.getWorldPosition(new THREE.Vector3())
			.distanceTo(c.getWorldPosition(new THREE.Vector3()));
		const goal = worldPoint(target),
			axis = goal.clone().sub(shoulder);
		const distance = Math.min(axis.length(), lengthA + lengthB - 0.001);
		axis.normalize();
		const along = (lengthA * lengthA - lengthB * lengthB + distance * distance) / (2 * distance);
		const outward = worldPoint(pole).sub(shoulder);
		outward.addScaledVector(axis, -outward.dot(axis)).normalize();
		const elbow = shoulder
			.clone()
			.addScaledVector(axis, along)
			.addScaledVector(outward, Math.sqrt(Math.max(0, lengthA * lengthA - along * along)));
		aim(a, b, elbow);
		aim(b, c, goal);
	}
	function pose(seconds: number) {
		for (const [name, joint] of bones) {
			joint.position.copy(bind.get(name)!.position);
			joint.quaternion.copy(bind.get(name)!.rotation);
		}
		const breath = Math.sin(seconds * 1.7),
			sway = Math.sin(seconds * 0.9);
		// A seated hip stays on the cushion; breathing comes from the spine, not hovering.
		bone('pelvis').position.z = origin.z - (debtor ? 0.4 : seated ? 0.45 : 0) + (seated ? 0 : breath * 0.012);
		bone('spine_01').rotateX((debtor ? 0.16 : -0.02) + breath * 0.035);
		bone('spine_02').rotateZ(sway * (debtor ? 0.045 : 0.025));
		bone('spine_03').rotateY(Math.sin(seconds * 0.7) * 0.05);
		outfit.updateMatrixWorld(true);
		for (const side of ['l', 'r']) {
			const sign = side === 'l' ? 1 : -1;
			const foot: Point = [sign * (seated ? 0.2 : 0.1), 0.085, debtor ? -0.28 : seated ? 0.43 : -0.085];
			solveLimb(`thigh_${side}`, `calf_${side}`, `foot_${side}`, foot, [sign * 0.2, 0.3, 1]);
			const joint = bone(`foot_${side}`);
			joint.quaternion.copy(
				joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(baseFoot.get(side)!)
			);
		}
		outfit.updateMatrixWorld(true);
		const reach = Math.sin(seconds * 1.25);
		const height = debtor ? 0.81 : seated ? 0.82 : 1.13;
		solveLimb(
			'upperarm_l',
			'lowerarm_l',
			'hand_l',
			debtor
				? [0.07 + sway * 0.018, height + breath * 0.035, 0.32 + reach * 0.025]
				: [0.46 + reach * 0.035, height + breath * 0.05, 0.24],
			[0.65, height, -0.15]
		);
		solveLimb(
			'upperarm_r',
			'lowerarm_r',
			'hand_r',
			debtor
				? [-0.07 + sway * 0.018, height + breath * 0.035, 0.32 + reach * 0.025]
				: [-0.34 + sway * 0.035, seated ? 0.76 + reach * 0.025 : 0.96 + reach * 0.05, 0.18],
			[-0.65, height, -0.15]
		);
		for (const side of ['l', 'r']) {
			for (const digit of ['index', 'middle', 'ring', 'pinky'])
				for (const segment of ['01', '02', '03']) {
					bone(`${digit}_${segment}_${side}`).rotateX((debtor || side === 'l' ? 0.8 : 0.25) + breath * 0.06);
				}
		}
		outfit.updateMatrixWorld(true);
	}
	function wristLoop(side: string) {
		const loop = mesh(
			new THREE.TorusGeometry(0.035, 0.007, 12, 48),
			rope,
			[0, 0.018, 0],
			[1, 1, 1],
			bone(`hand_${side}`)
		);
		loop.rotation.x = Math.PI / 2;
	}
	if (debtor) {
		wristLoop('l');
		wristLoop('r');
	}

	// Avatar is a curved face surface on a solid head, rather than a floating portrait.
	const head = new THREE.Group();
	head.position.set(0, 0.11, 0.01);
	head.scale.setScalar(0.74);
	head.rotation.set(debtor ? 0.17 : -0.025, -0.09, debtor ? -0.2 : 0);
	bone('Head').add(head);
	oval([0, -0.22, 0], [0.075, 0.13, 0.07], skin, head);
	oval([0, 0, 0], [0.215, 0.265, 0.185], skin, head);
	oval([-0.214, -0.01, 0], [0.04, 0.07, 0.045], skin, head);
	oval([0.214, -0.01, 0], [0.04, 0.07, 0.045], skin, head);
	mesh(
		new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, 1.05),
		hair,
		[0, 0.03, -0.015],
		[0.224, 0.265, 0.19],
		head
	);
	const faceCanvas = document.createElement('canvas');
	faceCanvas.width = faceCanvas.height = 256;
	const faceContext = faceCanvas.getContext('2d')!;
	faceContext.fillStyle = entry.member.color || '#677661';
	faceContext.fillRect(0, 0, 256, 256);
	faceContext.fillStyle = '#fff7e8';
	faceContext.font = '600 92px system-ui';
	faceContext.textAlign = 'center';
	faceContext.textBaseline = 'middle';
	faceContext.fillText(
		entry.member.name
			.split(' ')
			.filter(Boolean)
			.slice(-2)
			.map((n) => n[0])
			.join(''),
		128,
		132
	);
	const faceTexture = new THREE.CanvasTexture(faceCanvas);
	faceTexture.colorSpace = THREE.SRGBColorSpace;
	const faceMaterial = new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.8 });
	materials.push(faceMaterial);
	const faceGeometry = new THREE.BufferGeometry();
	const faceVertices: number[] = [],
		faceUvs: number[] = [],
		faceIndices: number[] = [];
	// Concentric rings follow the head surface; a simple triangle fan would sink
	// through the head between its centre and perimeter and obscure the photograph.
	const faceRings = 24,
		faceSegments = 96;
	for (let ring = 0; ring <= faceRings; ring++) {
		for (let segment = 0; segment <= faceSegments; segment++) {
			const radius = ring / faceRings;
			const angle = (segment / faceSegments) * Math.PI * 2;
			const x = Math.cos(angle) * radius,
				y = Math.sin(angle) * radius;
			faceVertices.push(x * 0.192, y * 0.227, 0.105 + 0.1 * Math.sqrt(Math.max(0, 1 - radius * radius)));
			faceUvs.push((x + 1) / 2, (y + 1) / 2);
			if (ring < faceRings && segment < faceSegments) {
				const a = ring * (faceSegments + 1) + segment,
					b = a + faceSegments + 1;
				faceIndices.push(a, b, b + 1, a, b + 1, a + 1);
			}
		}
	}
	faceGeometry.setAttribute('position', new THREE.Float32BufferAttribute(faceVertices, 3));
	faceGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(faceUvs, 2));
	faceGeometry.setIndex(faceIndices);
	faceGeometry.computeVertexNormals();
	mesh(faceGeometry, faceMaterial, [0, -0.015, 0], [1, 1, 1], head);
	if (entry.tier === 'sovereign') {
		const crown = new THREE.Group();
		crown.position.y = 0.19;
		crown.scale.z = 0.86;
		head.add(crown);
		const ruby = material('#a51d3a', 0.25, 0.16);
		const pearl = material('#fff3ca', 0.25, 0.22);
		// Closed, profiled metal circlet with rolled edges and cast fleur-de-lis.
		const profile = [
			[0.213, 0],
			[0.236, 0],
			[0.239, 0.014],
			[0.232, 0.065],
			[0.24, 0.078],
			[0.219, 0.078],
			[0.213, 0]
		];
		mesh(
			new THREE.LatheGeometry(
				profile.map(([x, y]) => new THREE.Vector2(x, y)),
				96
			),
			gold,
			[0, 0, 0],
			[1, 1, 1],
			crown
		);
		for (const y of [0.008, 0.07]) {
			const rim = mesh(new THREE.TorusGeometry(0.232, 0.009, 12, 96), gold, [0, y, 0], [1, 1, 1], crown);
			rim.rotation.x = Math.PI / 2;
		}
		const lily = new THREE.Shape();
		lily.moveTo(-0.025, 0);
		lily.bezierCurveTo(-0.018, 0.038, -0.078, 0.048, -0.044, 0.079);
		lily.quadraticCurveTo(-0.013, 0.08, -0.009, 0.047);
		lily.bezierCurveTo(-0.036, 0.095, -0.014, 0.115, 0, 0.14);
		lily.bezierCurveTo(0.014, 0.115, 0.036, 0.095, 0.009, 0.047);
		lily.quadraticCurveTo(0.013, 0.08, 0.044, 0.079);
		lily.bezierCurveTo(0.078, 0.048, 0.018, 0.038, 0.025, 0);
		lily.closePath();
		for (let i = 0; i < 8; i++) {
			const angle = (i / 8) * Math.PI * 2;
			const ornament = new THREE.Group();
			ornament.position.set(Math.sin(angle) * 0.225, 0.064, Math.cos(angle) * 0.225);
			ornament.rotation.y = angle;
			crown.add(ornament);
			mesh(
				new THREE.ExtrudeGeometry(lily, {
					depth: 0.009,
					bevelEnabled: true,
					bevelThickness: 0.003,
					bevelSize: 0.003,
					bevelSegments: 3,
					curveSegments: 12
				}),
				gold,
				[0, 0, 0],
				[1, 1, 1],
				ornament
			);
			mesh(
				new THREE.OctahedronGeometry(1, 1),
				i % 2 ? pearl : ruby,
				[0, -0.027, 0.014],
				[0.019, 0.024, 0.013],
				ornament
			);
		}
		// Crossed arches and a finial give the crown depth from every viewing angle.
		for (let i = 0; i < 2; i++) {
			const points = Array.from({ length: 33 }, (_, j) => {
				const angle = (j / 32) * Math.PI;
				return new THREE.Vector3(Math.cos(angle) * 0.22, 0.08 + Math.sin(angle) * 0.22, 0);
			});
			const arch = mesh(
				new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.009, 8, false),
				gold,
				[0, 0, 0],
				[1, 1, 1],
				crown
			);
			arch.rotation.y = (i * Math.PI) / 2;
		}
		oval([0, 0.31, 0], [0.025, 0.025, 0.025], gold, crown);
		mesh(new THREE.BoxGeometry(0.009, 0.055, 0.009), gold, [0, 0.35, 0], [1, 1, 1], crown);
		mesh(new THREE.BoxGeometry(0.035, 0.009, 0.009), gold, [0, 0.36, 0], [1, 1, 1], crown);
	}
	const marker = new THREE.Object3D();
	marker.position.set(0, 0.025, 0);
	bone('hand_l').add(marker);
	model.rotation.y = debtor ? -0.4 : seated ? -0.18 : -0.22;
	pose(0);
	canvas.dataset.modelId = model.uuid;
	let triangles = 0;
	model.traverse((object) => {
		if (object instanceof THREE.Mesh && object.visible)
			triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
	});
	canvas.dataset.triangles = String(triangles);
	canvas.dataset.rig = 'skinned';

	function render() {
		if (disposed || engine.getContext().isContextLost()) return;
		// Supersample even on standard-DPI displays so the denser mesh stays crisp.
		const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
		// Both figure sizes share a 2:3 aspect ratio. Reuse one render buffer rather
		// than reallocating it as the animation alternates between large/small figures.
		const width = Math.round(110 * ratio);
		const height = Math.round(165 * ratio);
		if (engine.domElement.width !== width || engine.domElement.height !== height)
			engine.setSize(width, height, false);
		engine.render(scene, camera);
		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		output!.clearRect(0, 0, width, height);
		output!.drawImage(engine.domElement, 0, 0);
		const point = marker.getWorldPosition(new THREE.Vector3()).project(camera);
		const state = { x: ((point.x + 1) / 2) * 100, y: ((1 - point.y) / 2) * 100, avatar: loadedAvatar };
		const signature = JSON.stringify(state);
		if (signature !== lastRenderState) {
			lastRenderState = signature;
			onrender(state);
		}
	}
	function safeRender() {
		try {
			render();
		} catch {
			onfailure();
		}
	}
	const resize = new ResizeObserver(safeRender);
	resize.observe(canvas);
	const image = new Image();
	image.crossOrigin = 'anonymous';
	image.referrerPolicy = 'no-referrer';
	image.onload = () => {
		if (disposed) return;
		try {
			const size = Math.min(image.naturalWidth, image.naturalHeight);
			faceContext.drawImage(
				image,
				(image.naturalWidth - size) / 2,
				(image.naturalHeight - size) / 2,
				size,
				size,
				0,
				0,
				256,
				256
			);
			faceTexture.needsUpdate = true;
			loadedAvatar = true;
			safeRender();
		} catch {
			/* Keep the initials if this image cannot be used as a texture. */
		}
	};
	if (entry.member.avatarUrl) image.src = entry.member.avatarUrl;
	function contextLost() {
		lastRenderState = '';
		onfailure();
	}
	engine.domElement.addEventListener('webglcontextlost', contextLost);
	engine.domElement.addEventListener('webglcontextrestored', safeRender);
	safeRender();
	const animationKey = Symbol(entry.member.id);
	const phase = [...entry.member.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 29;
	const rest = head.rotation.clone();
	const restPosition = head.position.clone();
	let visible = false;
	function idle(time: number) {
		const seconds = time / 1000 + phase;
		pose(seconds);
		head.position.y = restPosition.y + Math.sin(seconds * 1.7) * 0.008;
		head.rotation.y = rest.y + Math.sin(seconds * 1.1) * 0.14;
		head.rotation.x = rest.x + Math.sin(seconds * 1.4) * (debtor ? 0.09 : 0.05);
		head.rotation.z = rest.z + Math.sin(seconds * 1.2) * 0.025;
		safeRender();
	}

	function updateMotion() {
		const active = visible && !document.hidden;
		setAnimation(animationKey, active ? idle : undefined);
		canvas.dataset.motion = active ? 'idle' : 'still';
	}
	const visibility = new IntersectionObserver((entries) => {
		visible = entries[0].isIntersecting;
		updateMotion();
	});
	visibility.observe(canvas);
	document.addEventListener('visibilitychange', updateMotion);
	updateMotion();
	return {
		dispose() {
			disposed = true;
			setAnimation(animationKey);
			visibility.disconnect();
			document.removeEventListener('visibilitychange', updateMotion);
			resize.disconnect();
			image.onload = image.onerror = null;
			image.src = '';
			engine.domElement.removeEventListener('webglcontextlost', contextLost);
			engine.domElement.removeEventListener('webglcontextrestored', safeRender);
			geometries.forEach((geometry) => geometry.dispose());
			skeletons.forEach((skeleton) => skeleton.dispose());
			materials.forEach((mat) => mat.dispose());
			faceTexture.dispose();
			scene.clear();
			if (--clients === 0) {
				engine.dispose();
				engine.forceContextLoss();
				renderer = undefined;
			}
		}
	};
}
