import { requestUrl, Notice } from "obsidian";

interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
			}>;
		};
		finishReason?: string;
	}>;
	error?: {
		message?: string;
		code?: number;
	};
}

export interface ImagePart {
	base64: string;
	mimeType: string;
}

export class GeminiClient {
	private apiKey: string;
	private model: string;

	constructor(apiKey: string, model: string) {
		this.apiKey = apiKey;
		this.model = model;
	}

	async extractText(
		imageBase64: string,
		mimeType: string,
		prompt: string
	): Promise<string> {
		return this.extractTextFromImages(
			[{ base64: imageBase64, mimeType }],
			prompt
		);
	}

	/**
	 * Send multiple images in a single request.
	 * Gemini supports multiple inline_data parts, so the model
	 * sees all pages together and can produce a coherent transcription.
	 */
	async extractTextFromImages(
		images: ImagePart[],
		prompt: string
	): Promise<string> {
		if (!this.apiKey) {
			new Notice(
				"No API key configured. Please add your key in the plugin settings."
			);
			throw new Error("Missing Gemini API key");
		}

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

		const parts: Array<Record<string, unknown>> = [{ text: prompt }];

		for (const img of images) {
			parts.push({
				inline_data: {
					mime_type: img.mimeType,
					data: img.base64,
				},
			});
		}

		const body = {
			contents: [{ parts }],
			generationConfig: {
				temperature: 0.1,
				maxOutputTokens: 8192,
			},
		};

		let response;
		try {
			response = await requestUrl({
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		} catch (err: unknown) {
			const error = err as { status?: number; message?: string };
			if (error.status === 429) {
				throw new Error(
					"Rate limited by Gemini API. Please wait a moment and try again."
				);
			}
			if (error.status === 403) {
				throw new Error(
					"Gemini API key is invalid or does not have access. Check your key in settings."
				);
			}
			throw new Error(
				`Gemini API request failed: ${error.message || "Network error"}`
			);
		}

		const data = response.json as GeminiResponse;

		if (data.error) {
			throw new Error(
				`Gemini API error: ${data.error.message || "Unknown error"}`
			);
		}

		const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
		if (!text) {
			throw new Error(
				"Gemini returned an empty response. The image may be unreadable."
			);
		}

		return text.trim();
	}
}
