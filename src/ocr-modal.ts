import {
	App,
	Editor,
	FuzzySuggestModal,
	Modal,
	Notice,
	TFile,
} from "obsidian";
import { GeminiClient } from "./gemini";
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

// ─── Main OCR Modal ──────────────────────────────────────────────────

type ModalState = "select" | "processing" | "preview";

export class OcrModal extends Modal {
	private settings: HandwritingToTextSettings;
	private editor: Editor;

	private state: ModalState = "select";

	// Image data
	private imageBuffer: ArrayBuffer | null = null;
	private imageMimeType = "image/jpeg";
	private imageFilename = "";

	// Extracted text
	private extractedText = "";

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

	onOpen() {
		this.renderSelect();
	}

	onClose() {
		this.contentEl.empty();
		this.imageBuffer = null;
	}

	/**
	 * Start processing with an image already loaded (used by clipboard command).
	 */
	startWithImage(buffer: ArrayBuffer, mimeType: string, filename: string) {
		this.imageBuffer = buffer;
		this.imageMimeType = mimeType;
		this.imageFilename = filename;
		this.processImage();
	}

	// ─── State 1: Image Selection ────────────────────────────────────

	private renderSelect() {
		this.state = "select";
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("Scan Handwriting");

		const container = contentEl.createDiv({
			cls: "hwt-drop-zone",
		});

		container.createDiv({
			cls: "hwt-drop-zone-text",
			text: "Drop an image here, or use the buttons below",
		});

		// Hidden file input
		const fileInput = container.createEl("input", { type: "file" });
		fileInput.accept = "image/*";
		fileInput.style.display = "none";
		fileInput.addEventListener("change", () => {
			const file = fileInput.files?.[0];
			if (file) this.handleFile(file);
		});

		// Click the drop zone to open file picker
		container.addEventListener("click", () => fileInput.click());

		// Drag & drop
		container.addEventListener("dragover", (e) => {
			e.preventDefault();
			container.addClass("drag-over");
		});
		container.addEventListener("dragleave", () => {
			container.removeClass("drag-over");
		});
		container.addEventListener("drop", (e) => {
			e.preventDefault();
			container.removeClass("drag-over");
			const file = e.dataTransfer?.files[0];
			if (file && file.type.startsWith("image/")) {
				this.handleFile(file);
			}
		});

		// Buttons
		const buttons = contentEl.createDiv({ cls: "hwt-buttons" });

		const chooseBtn = buttons.createEl("button", { text: "Choose Image" });
		chooseBtn.addEventListener("click", () => fileInput.click());

		const vaultBtn = buttons.createEl("button", {
			text: "Select from Vault",
		});
		vaultBtn.addEventListener("click", () => {
			const picker = new VaultImagePicker(this.app, (vaultFile) => {
				this.handleVaultFile(vaultFile);
			});
			picker.open();
		});
	}

	private async handleFile(file: File) {
		this.imageBuffer = await file.arrayBuffer();
		this.imageMimeType = file.type || getMimeType(file.name);
		this.imageFilename = file.name;
		this.processImage();
	}

	private async handleVaultFile(file: TFile) {
		this.imageBuffer = await this.app.vault.readBinary(file);
		this.imageMimeType = getMimeType(file.name);
		this.imageFilename = file.name;
		this.processImage();
	}

	// ─── State 2: Processing ─────────────────────────────────────────

	private async processImage() {
		if (!this.imageBuffer) return;

		this.state = "processing";
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("Extracting Text...");

		const container = contentEl.createDiv({
			cls: "hwt-processing",
		});

		// Image thumbnail
		const normalized = await normalizeImage(this.imageBuffer, this.imageMimeType);
		this.imageBuffer = normalized.buffer;
		this.imageMimeType = normalized.mimeType;

		const blob = new Blob([this.imageBuffer], {
			type: this.imageMimeType,
		});
		const objectUrl = URL.createObjectURL(blob);

		const img = container.createEl("img", {
			cls: "hwt-image-preview",
		});
		img.addEventListener("error", () => {
			URL.revokeObjectURL(objectUrl);
			img.remove();
		});
		img.src = objectUrl;

		container.createDiv({ cls: "hwt-spinner" });
		container.createDiv({
			cls: "hwt-processing-text",
			text: "Sending image to Gemini...",
		});

		try {
			const base64 = arrayBufferToBase64(this.imageBuffer);
			const client = new GeminiClient(
				this.settings.geminiApiKey,
				this.settings.model
			);
			this.extractedText = await client.extractText(
				base64,
				this.imageMimeType,
				this.settings.ocrPrompt
			);
			URL.revokeObjectURL(objectUrl);
			this.renderPreview();
		} catch (err: unknown) {
			URL.revokeObjectURL(objectUrl);
			const message =
				err instanceof Error ? err.message : "Unknown error";
			this.renderError(message);
		}
	}

	// ─── State 3: Preview & Insert ───────────────────────────────────

	private renderPreview() {
		this.state = "preview";
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("Review Transcription");

		const preview = contentEl.createDiv({ cls: "hwt-preview" });

		// Image thumbnail — hide if the browser can't decode it (e.g. HEIC)
		if (this.imageBuffer) {
			const blob = new Blob([this.imageBuffer], {
				type: this.imageMimeType,
			});
			const objectUrl = URL.createObjectURL(blob);
			const img = preview.createEl("img", {
				cls: "hwt-image-preview",
			});
			img.addEventListener("error", () => {
				URL.revokeObjectURL(objectUrl);
				img.remove();
			});
			img.src = objectUrl;
		}

		// Editable textarea
		const textarea = preview.createEl("textarea", {
			cls: "hwt-textarea",
		});
		textarea.value = this.extractedText;
		textarea.addEventListener("input", () => {
			this.extractedText = textarea.value;
		});

		// Action buttons
		const actions = preview.createDiv({ cls: "hwt-actions" });

		const reExtractBtn = actions.createEl("button", {
			text: "Re-extract",
		});
		reExtractBtn.addEventListener("click", () => this.processImage());

		const insertBtn = actions.createEl("button", {
			text: "Insert into Note",
			cls: "mod-cta",
		});
		insertBtn.addEventListener("click", () => this.insertIntoNote());
	}

	// ─── Insert Logic ────────────────────────────────────────────────

	private insertIntoNote() {
		this.editor.replaceSelection(this.extractedText);
		this.close();
		new Notice("Text inserted successfully");
	}

	// ─── Error State ─────────────────────────────────────────────────

	private renderError(message: string) {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle("Error");

		const errorDiv = contentEl.createDiv({ cls: "hwt-error" });
		errorDiv.setText(message);

		const actions = contentEl.createDiv({ cls: "hwt-actions" });
		actions.style.marginTop = "16px";

		const backBtn = actions.createEl("button", { text: "Back" });
		backBtn.addEventListener("click", () => this.renderSelect());

		const retryBtn = actions.createEl("button", {
			text: "Retry",
			cls: "mod-cta",
		});
		retryBtn.addEventListener("click", () => this.processImage());
	}
}
