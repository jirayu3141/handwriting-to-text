import {
	App,
	Editor,
	FuzzySuggestModal,
	Modal,
	Notice,
	TFile,
} from "obsidian";
import { GeminiClient, type ImagePart } from "./gemini";
import type { HandwritingToTextSettings } from "./settings";
import {
	arrayBufferToBase64,
	getMimeType,
	normalizeImage,
} from "./utils";

// ─── Vault Image Picker (FuzzySuggestModal) ──────────────────────────

class VaultImagePicker extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder("Search for an image in your vault...");
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((f) =>
				/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.extension)
			);
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		this.onChoose(item);
	}
}

// ─── Image Item Interface ────────────────────────────────────────────

interface ImageItem {
	id: string;
	buffer: ArrayBuffer;
	mimeType: string;
	filename: string;
	status: "pending" | "processing" | "done" | "error";
	extractedText?: string;
	error?: string;
	thumbnailUrl?: string;
}

// ─── Main OCR Modal ──────────────────────────────────────────────────

type ModalState = "select" | "queue" | "processing" | "preview";

export class OcrModal extends Modal {
	private settings: HandwritingToTextSettings;
	private editor: Editor;
	private state: ModalState = "select";
	private images: ImageItem[] = [];
	private combinedText = "";
	private objectUrls: string[] = [];

	constructor(
		app: App,
		settings: HandwritingToTextSettings,
		editor: Editor
	) {
		super(app);
		this.settings = settings;
		this.editor = editor;
		this.modalEl.addClass("hwt-modal");
	}

	onOpen(): void {
		this.renderSelect();
	}

	onClose(): void {
		this.contentEl.empty();
		this.revokeAllUrls();
		this.images = [];
	}

	private revokeAllUrls(): void {
		for (const url of this.objectUrls) {
			URL.revokeObjectURL(url);
		}
		this.objectUrls = [];
		for (const img of this.images) {
			if (img.thumbnailUrl) {
				URL.revokeObjectURL(img.thumbnailUrl);
				img.thumbnailUrl = undefined;
			}
		}
	}

	private createObjectUrl(blob: Blob): string {
		const url = URL.createObjectURL(blob);
		this.objectUrls.push(url);
		return url;
	}

	private generateId(): string {
		return (
			Date.now().toString(36) +
			Math.random().toString(36).slice(2, 8)
		);
	}

	/**
	 * Start with a single pre-loaded image (used by clipboard command).
	 * Goes directly to processing — no queue screen.
	 */
	startWithImage(
		buffer: ArrayBuffer,
		mimeType: string,
		filename: string
	): void {
		this.images = [
			{
				id: this.generateId(),
				buffer,
				mimeType,
				filename,
				status: "pending",
			},
		];
		void this.processAllImages();
	}

	// ─── State 1: Image Selection ────────────────────────────────────

	private renderSelect(): void {
		this.state = "select";
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("Scan handwriting");

		// Hidden file input
		const fileInput = contentEl.createEl("input", { type: "file" });
		fileInput.accept = "image/*";
		fileInput.multiple = true;
		fileInput.addClass("hwt-hidden");
		fileInput.addEventListener("change", () => {
			if (fileInput.files && fileInput.files.length > 0) {
				void this.handleFiles(Array.from(fileInput.files));
			}
		});

		// Primary action
		const chooseBtn = contentEl.createEl("button", {
			text: "Choose images",
			cls: "hwt-select-btn mod-cta",
		});
		chooseBtn.addEventListener("click", () => fileInput.click());

		// Subtle vault link
		const vaultLink = contentEl.createDiv({ cls: "hwt-vault-link" });
		vaultLink.setText("or select from vault");
		vaultLink.addEventListener("click", () => {
			new VaultImagePicker(this.app, (f) =>
				void this.handleVaultFile(f)
			).open();
		});

		// Silent drag-and-drop support for desktop
		contentEl.addEventListener("dragover", (e) => {
			e.preventDefault();
		});
		contentEl.addEventListener("drop", (e) => {
			e.preventDefault();
			const files = e.dataTransfer?.files;
			if (files && files.length > 0) {
				const imageFiles = Array.from(files).filter((f) =>
					f.type.startsWith("image/")
				);
				if (imageFiles.length > 0) {
					void this.handleFiles(imageFiles);
				}
			}
		});
	}

	private async handleFiles(files: File[]): Promise<void> {
		for (const file of files) {
			const buffer = await file.arrayBuffer();
			const mimeType = file.type || getMimeType(file.name);
			this.images.push({
				id: this.generateId(),
				buffer,
				mimeType,
				filename: file.name,
				status: "pending",
			});
		}
		await this.renderQueue();
	}

	private async handleVaultFile(file: TFile): Promise<void> {
		const buffer = await this.app.vault.readBinary(file);
		const mimeType = getMimeType(file.name);
		this.images.push({
			id: this.generateId(),
			buffer,
			mimeType,
			filename: file.name,
			status: "pending",
		});
		await this.renderQueue();
	}

	// ─── State 2: Image Queue ────────────────────────────────────────

	private async renderQueue(): Promise<void> {
		this.state = "queue";
		const { contentEl } = this;
		contentEl.empty();

		const total = this.images.length;
		this.setTitle(
			`${total} ${total === 1 ? "page" : "pages"} ready`
		);

		await this.ensureThumbnails();

		// Queue list
		const list = contentEl.createDiv({ cls: "hwt-queue-list" });
		this.renderQueueList(list);

		// Hidden file input for "Add more"
		const addInput = contentEl.createEl("input", { type: "file" });
		addInput.accept = "image/*";
		addInput.multiple = true;
		addInput.addClass("hwt-hidden");
		addInput.addEventListener("change", () => {
			if (addInput.files && addInput.files.length > 0) {
				void this.addMoreFiles(Array.from(addInput.files));
			}
		});

		// Actions
		const actions = contentEl.createDiv({ cls: "hwt-queue-actions" });

		const addMoreBtn = actions.createEl("button", {
			cls: "hwt-queue-add-btn",
			text: "+ Add more",
		});
		addMoreBtn.addEventListener("click", () => addInput.click());

		const processBtn = actions.createEl("button", {
			text: "Extract text",
			cls: "mod-cta",
		});
		processBtn.addEventListener("click", () =>
			void this.processAllImages()
		);
	}

	private async ensureThumbnails(): Promise<void> {
		for (const item of this.images) {
			if (item.thumbnailUrl) continue;
			try {
				const normalized = await normalizeImage(
					item.buffer,
					item.mimeType
				);
				item.buffer = normalized.buffer;
				item.mimeType = normalized.mimeType;
			} catch {
				// Use raw buffer if normalization fails
			}
			const blob = new Blob([item.buffer], { type: item.mimeType });
			item.thumbnailUrl = this.createObjectUrl(blob);
		}
	}

	private async addMoreFiles(files: File[]): Promise<void> {
		for (const file of files) {
			const buffer = await file.arrayBuffer();
			const mimeType = file.type || getMimeType(file.name);
			this.images.push({
				id: this.generateId(),
				buffer,
				mimeType,
				filename: file.name,
				status: "pending",
			});
		}
		await this.renderQueue();
	}

	private renderQueueList(list: HTMLElement): void {
		list.empty();

		const showReorder = this.images.length > 1;

		for (let i = 0; i < this.images.length; i++) {
			const item = this.images[i];
			const row = list.createDiv({ cls: "hwt-queue-item" });

			// Thumbnail
			if (item.thumbnailUrl) {
				const thumb = row.createEl("img", {
					cls: "hwt-queue-thumb",
				});
				thumb.src = item.thumbnailUrl;
				thumb.alt = `Page ${i + 1}`;
			}

			// Page label
			row.createDiv({
				cls: "hwt-queue-page-label",
				text: `Page ${i + 1}`,
			});

			// Reorder buttons — only when 2+ images
			if (showReorder) {
				const reorder = row.createDiv({
					cls: "hwt-queue-reorder",
				});

				const upBtn = reorder.createEl("button", {
					cls: "hwt-queue-move-btn",
					text: "\u2191",
				});
				upBtn.setAttribute("aria-label", "Move up");
				if (i === 0) {
					upBtn.disabled = true;
				} else {
					upBtn.addEventListener("click", () => {
						this.swapImages(i, i - 1);
						this.renderQueueList(list);
					});
				}

				const downBtn = reorder.createEl("button", {
					cls: "hwt-queue-move-btn",
					text: "\u2193",
				});
				downBtn.setAttribute("aria-label", "Move down");
				if (i === this.images.length - 1) {
					downBtn.disabled = true;
				} else {
					downBtn.addEventListener("click", () => {
						this.swapImages(i, i + 1);
						this.renderQueueList(list);
					});
				}
			}

			// Remove button
			const removeBtn = row.createEl("button", {
				cls: "hwt-queue-remove",
				text: "\u00D7",
			});
			removeBtn.setAttribute("aria-label", "Remove");
			removeBtn.addEventListener("click", () => {
				this.images.splice(i, 1);
				if (this.images.length === 0) {
					this.renderSelect();
				} else {
					void this.renderQueue();
				}
			});
		}
	}

	private swapImages(a: number, b: number): void {
		const temp = this.images[a];
		this.images[a] = this.images[b];
		this.images[b] = temp;
	}

	// ─── State 3: Processing ─────────────────────────────────────────

	private async processAllImages(): Promise<void> {
		if (this.images.length === 0) return;

		if (!this.settings.geminiApiKey) {
			this.renderError(
				"No API key configured. Please set your Gemini API key in the plugin settings."
			);
			return;
		}

		this.state = "processing";
		const { contentEl } = this;
		contentEl.empty();

		const total = this.images.length;
		const isMulti = total > 1;

		this.setTitle("Extracting text...");

		const container = contentEl.createDiv({ cls: "hwt-processing" });
		container.createDiv({ cls: "hwt-spinner" });

		container.createDiv({
			cls: "hwt-processing-text",
			text: isMulti
				? `Sending ${total} pages to Gemini...`
				: "Sending image to Gemini...",
		});

		// Normalize all images and build the parts array
		const imageParts: ImagePart[] = [];
		for (const item of this.images) {
			item.status = "processing";
			try {
				const normalized = await normalizeImage(
					item.buffer,
					item.mimeType
				);
				item.buffer = normalized.buffer;
				item.mimeType = normalized.mimeType;
			} catch {
				// Use raw buffer if normalization fails
			}

			if (!item.thumbnailUrl) {
				const blob = new Blob([item.buffer], {
					type: item.mimeType,
				});
				item.thumbnailUrl = this.createObjectUrl(blob);
			}

			imageParts.push({
				base64: arrayBufferToBase64(item.buffer),
				mimeType: item.mimeType,
			});
		}

		// Build prompt
		let prompt = this.settings.ocrPrompt;
		if (isMulti) {
			const sep = this.settings.pageSeparator || "---";
			const showNums = this.settings.showPageNumbers !== false;
			prompt +=
				`\n\nYou are receiving ${total} images. They are consecutive pages of the same document, in order (image 1 = page 1, image 2 = page 2, etc.).` +
				` Transcribe each page. Between pages, insert a separator line.` +
				(showNums
					? ` Use this exact format for separators: "${sep} Page N ${sep}" where N is the page number.`
					: ` Use this exact separator: "${sep}".`) +
				` Do not add a separator before the first page.`;
		}

		const client = new GeminiClient(
			this.settings.geminiApiKey,
			this.settings.model
		);

		try {
			this.combinedText = await client.extractTextFromImages(
				imageParts,
				prompt
			);
			for (const item of this.images) {
				item.status = "done";
			}
		} catch (err: unknown) {
			const msg =
				err instanceof Error ? err.message : "Unknown error";
			for (const item of this.images) {
				item.status = "error";
				item.error = msg;
			}
			this.combinedText = "";
		}

		this.renderPreview();
	}

	// ─── State 4: Preview & Insert ───────────────────────────────────

	private renderPreview(): void {
		this.state = "preview";
		const { contentEl } = this;
		contentEl.empty();

		const hasErrors = this.images.some(
			(img) => img.status === "error"
		);

		if (hasErrors) {
			this.setTitle("Something went wrong");
			contentEl
				.createDiv({ cls: "hwt-error" })
				.setText(
					"Failed to process images. Please close and try again."
				);
		} else {
			this.setTitle("Review text");
		}

		// Editable textarea
		const textarea = contentEl.createEl("textarea", {
			cls: "hwt-textarea",
		});
		textarea.value = this.combinedText;
		textarea.addEventListener("input", () => {
			this.combinedText = textarea.value;
		});

		// Single action
		const actions = contentEl.createDiv({ cls: "hwt-actions" });

		const insertBtn = actions.createEl("button", {
			text: "Insert into note",
			cls: "mod-cta",
		});
		insertBtn.addEventListener("click", () => this.insertIntoNote());
	}

	// ─── Insert & Error ──────────────────────────────────────────────

	private insertIntoNote(): void {
		this.editor.replaceSelection(this.combinedText);
		this.close();
		new Notice("Text inserted!");
	}

	private renderError(message: string): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("Error");

		contentEl.createDiv({ cls: "hwt-error", text: message });

		const actions = contentEl.createDiv({
			cls: "hwt-actions hwt-error-actions",
		});

		const retryBtn = actions.createEl("button", {
			text: "Retry",
			cls: "mod-cta",
		});
		retryBtn.addEventListener("click", () =>
			void this.processAllImages()
		);
	}
}
