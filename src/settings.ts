import { App, PluginSettingTab, Setting } from "obsidian";
import type JournalOcrPlugin from "./main";

export interface JournalOcrSettings {
	geminiApiKey: string;
	model: string;
	ocrPrompt: string;
}

export const DEFAULT_SETTINGS: JournalOcrSettings = {
	geminiApiKey: "",
	model: "gemini-2.5-flash",
	ocrPrompt:
		"You are an expert at reading handwritten text from journal pages. " +
		"Transcribe the handwritten content in this image into clean, readable markdown text. " +
		"Join words that continue on the next line into flowing sentences — do NOT insert line breaks just because the handwriting reaches the edge of the page. " +
		"Only start a new paragraph when the writer clearly intended one (e.g. a blank line, large gap, or new topic). " +
		"Format lists as markdown lists. " +
		"If a word is illegible, write [illegible]. " +
		"If the writing contains non-English text (such as Thai), transcribe it faithfully. " +
		"Output only the transcribed text.",
};

const GEMINI_MODELS: Record<string, string> = {
	"gemini-3-flash-preview": "Gemini 3 Flash (latest, fast)",
	"gemini-3-pro-preview": "Gemini 3 Pro (best quality)",
	"gemini-2.5-flash": "Gemini 2.5 Flash (recommended)",
	"gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite (fastest, cheapest)",
	"gemini-2.5-pro": "Gemini 2.5 Pro (high quality, slower)",
};

export class JournalOcrSettingTab extends PluginSettingTab {
	plugin: JournalOcrPlugin;

	constructor(app: App, plugin: JournalOcrPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Google Gemini API key")
			.setDesc(
				"Get your API key from Google AI Studio (aistudio.google.com)"
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.geminiApiKey)
					.then((t) => {
						t.inputEl.type = "password";
						t.inputEl.style.width = "300px";
					})
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Which Gemini model to use for OCR")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(GEMINI_MODELS)) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("OCR prompt")
			.setDesc("The instruction sent to Gemini along with the image")
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter your OCR prompt")
					.setValue(this.plugin.settings.ocrPrompt)
					.then((t) => {
						t.inputEl.rows = 6;
						t.inputEl.style.width = "100%";
					})
					.onChange(async (value) => {
						this.plugin.settings.ocrPrompt = value;
						await this.plugin.saveSettings();
					})
			);

	}
}
