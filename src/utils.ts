const MIME_MAP: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	heic: "image/heic",
	heif: "image/heif",
};

// Formats that Chromium's <img> and createImageBitmap can handle natively
const WEB_SAFE_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
]);

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const CHUNK = 8192;
	const chunks: string[] = [];
	for (let i = 0; i < bytes.byteLength; i += CHUNK) {
		const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength));
		chunks.push(String.fromCharCode(...slice));
	}
	return btoa(chunks.join(""));
}

export function getMimeType(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() || "";
	return MIME_MAP[ext] || "image/jpeg";
}

export function getExtension(mimeType: string): string {
	for (const [ext, mime] of Object.entries(MIME_MAP)) {
		if (mime === mimeType) return ext;
	}
	return "jpg";
}

/**
 * Convert a non-web-safe image (e.g. HEIC) to JPEG using Electron's nativeImage.
 * On macOS, nativeImage delegates to the OS which supports HEIC via ImageIO.
 * Returns null if conversion fails or we're not on Electron (e.g. mobile).
 */
function convertWithNativeImage(
	buffer: ArrayBuffer
): { buffer: ArrayBuffer; mimeType: string } | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { nativeImage } = require("electron");
		const img = nativeImage.createFromBuffer(Buffer.from(buffer));
		if (img.isEmpty()) return null;
		const jpegBuffer = img.toJPEG(85);
		return {
			buffer: jpegBuffer.buffer.slice(
				jpegBuffer.byteOffset,
				jpegBuffer.byteOffset + jpegBuffer.byteLength
			),
			mimeType: "image/jpeg",
		};
	} catch {
		return null;
	}
}

/**
 * Try to create an ImageBitmap with a timeout.
 * Returns null if decoding fails or times out (e.g. HEIC on Chromium).
 */
function tryCreateBitmap(
	blob: Blob,
	timeoutMs = 5000
): Promise<ImageBitmap | null> {
	return Promise.race([
		createImageBitmap(blob).catch(() => null),
		new Promise<null>((resolve) =>
			setTimeout(() => resolve(null), timeoutMs)
		),
	]);
}

/**
 * Draw a bitmap to a canvas and export as JPEG.
 */
async function bitmapToJpeg(
	bitmap: ImageBitmap,
	targetWidth: number,
	targetHeight: number
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
	let canvas: OffscreenCanvas | HTMLCanvasElement;
	let ctx:
		| OffscreenCanvasRenderingContext2D
		| CanvasRenderingContext2D
		| null;

	if (typeof OffscreenCanvas !== "undefined") {
		canvas = new OffscreenCanvas(targetWidth, targetHeight);
		ctx = canvas.getContext("2d");
	} else {
		canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		ctx = canvas.getContext("2d");
	}

	if (!ctx) {
		throw new Error("Could not get canvas context");
	}

	ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

	let resultBlob: Blob;
	if (canvas instanceof OffscreenCanvas) {
		resultBlob = await canvas.convertToBlob({
			type: "image/jpeg",
			quality: 0.85,
		});
	} else {
		resultBlob = await new Promise<Blob>((resolve) => {
			(canvas as HTMLCanvasElement).toBlob(
				(b) => resolve(b!),
				"image/jpeg",
				0.85
			);
		});
	}

	return { buffer: await resultBlob.arrayBuffer(), mimeType: "image/jpeg" };
}

const MAX_DIMENSION = 4096;

/**
 * Normalize an image for display and API use:
 * 1. Convert non-web-safe formats (HEIC/HEIF) to JPEG
 * 2. Resize if longest side exceeds MAX_DIMENSION
 *
 * Returns a web-displayable JPEG/PNG buffer.
 * Only falls back to the original buffer if all conversion methods fail
 * (Gemini still handles HEIC natively, preview just won't show).
 */
export async function normalizeImage(
	buffer: ArrayBuffer,
	mimeType: string
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
	const needsConversion = !WEB_SAFE_MIMES.has(mimeType);

	// First try: createImageBitmap (works for web-safe formats, sometimes HEIC on macOS)
	const blob = new Blob([buffer], { type: mimeType });
	const bitmap = await tryCreateBitmap(blob);

	if (bitmap) {
		const { width, height } = bitmap;
		const needsResize =
			width > MAX_DIMENSION || height > MAX_DIMENSION;

		if (!needsConversion && !needsResize) {
			bitmap.close();
			return { buffer, mimeType };
		}

		// Draw through canvas to convert and/or resize
		const scale = needsResize
			? MAX_DIMENSION / Math.max(width, height)
			: 1;
		const result = await bitmapToJpeg(
			bitmap,
			Math.round(width * scale),
			Math.round(height * scale)
		);
		bitmap.close();
		return result;
	}

	// createImageBitmap failed (e.g. HEIC on Chromium) — try Electron's nativeImage
	if (needsConversion) {
		const converted = convertWithNativeImage(buffer);
		if (converted) {
			// Recurse to also handle resize if needed
			return normalizeImage(converted.buffer, converted.mimeType);
		}
	}

	// All conversions failed — return original (Gemini can still process it)
	return { buffer, mimeType };
}

export function generateFilename(extension: string): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const timestamp =
		`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
		`${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	return `journal-scan-${timestamp}.${extension}`;
}
