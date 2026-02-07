import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	HandwritingToTextSettingTab,
	type HandwritingToTextSettings,
} from "./settings";
import { OcrModal } from "./ocr-modal";

export default class HandwritingToTextPlugin extends Plugin {
	settings: HandwritingToTextSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		// Settings tab
		this.addSettingTab(new HandwritingToTextSettingTab(this.app, this));

		// Ribbon icon
		this.addRibbonIcon("scan", "Scan handwriting", () => {
			this.openOcrModal();
		});

		// Command: Scan from file/camera
		this.addCommand({
			id: "scan-handwriting",
			name: "Scan handwriting",
			editorCallback: (editor: Editor) => {
				const modal = new OcrModal(
					this.app,
					this.settings,
					editor
				);
				modal.open();
			},
		});

		// Command: Scan from clipboard
		this.addCommand({
			id: "scan-from-clipboard",
			name: "Scan from clipboard",
			editorCallback: async (editor: Editor) => {
				await this.scanFromClipboard(editor);
			},
		});
	}

	private openOcrModal() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Please open a note first, then try again.");
			return;
		}
		const modal = new OcrModal(
			this.app,
			this.settings,
			view.editor
		);
		modal.open();
	}

	private async scanFromClipboard(editor: Editor) {
		try {
			const clipboardItems = await navigator.clipboard.read();
			let imageBlob: Blob | null = null;

			for (const item of clipboardItems) {
				const imageType = item.types.find((t) =>
					t.startsWith("image/")
				);
				if (imageType) {
					imageBlob = await item.getType(imageType);
					break;
				}
			}

			if (!imageBlob) {
				new Notice(
					"No image found in clipboard. Copy an image first."
				);
				return;
			}

			const buffer = await imageBlob.arrayBuffer();
			const mimeType = imageBlob.type || "image/png";

			const modal = new OcrModal(
				this.app,
				this.settings,
				editor
			);
			modal.open();
			modal.startWithImage(buffer, mimeType, "clipboard");
		} catch (err: unknown) {
			const message =
				err instanceof Error ? err.message : "Unknown error";
			new Notice(`Failed to read clipboard: ${message}`);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
