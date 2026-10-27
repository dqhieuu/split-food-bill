/** Phone photos are several megabytes; 1600 px keeps receipt text legible at a fraction of the size. */
const MAX_DIMENSION = 1600;
const QUALITY = 0.82;
const MAX_UPLOAD_BYTES = 2_000_000;

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** Downscales and re-encodes a photo, which also strips EXIF data such as location. */
export async function compressImage(file: File): Promise<Blob> {
	if (!file.type.startsWith('image/')) throw new Error('Hãy chọn một tệp ảnh.');
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	} catch {
		throw new Error('Trình duyệt không đọc được ảnh này. Hãy chọn ảnh JPEG, PNG hoặc WebP.');
	}
	const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	// Browsers without WebP encoding silently return PNG, so check the type before accepting it.
	const webp = await encode(canvas, 'image/webp');
	const blob = webp?.type === 'image/webp' ? webp : await encode(canvas, 'image/jpeg');
	if (!blob) throw new Error('Không xử lý được ảnh.');
	if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Ảnh quá lớn sau khi nén. Hãy chọn ảnh khác.');
	return blob;
}
