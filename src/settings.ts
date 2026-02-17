import { App, PluginSettingTab, Setting } from "obsidian";
import type HandwritingToTextPlugin from "./main";

export interface HandwritingToTextSettings {
	geminiApiKey: string;
	model: string;
	ocrPrompt: string;
	pageSeparator: string;
	showPageNumbers: boolean;
}

export const DEFAULT_SETTINGS: HandwritingToTextSettings = {
	geminiApiKey: "",
	model: "gemini-2.5-flash",
	ocrPrompt:
		"You are an expert at reading handwritten text. " +
		"Transcribe the handwritten content in this image into clean, readable markdown text. " +
		"Join words that continue on the next line into flowing sentences — do NOT insert line breaks just because the handwriting reaches the edge of the page. " +
		"Only start a new paragraph when the writer clearly intended one (e.g. a blank line, large gap, or new topic). " +
		"Format lists as markdown lists. " +
		"If a word is illegible, write [illegible]. " +
		"If the writing contains non-English text (such as Thai), transcribe it faithfully. " +
		"Output only the transcribed text.",
	pageSeparator: "---",
	showPageNumbers: true,
};

const GEMINI_MODELS: Record<string, string> = {
	"gemini-2.5-flash": "Gemini 2.5 Flash (recommended)",
	"gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite (fastest)",
	"gemini-2.5-pro": "Gemini 2.5 Pro (best quality)",
};

export class HandwritingToTextSettingTab extends PluginSettingTab {
	plugin: HandwritingToTextPlugin;

	constructor(app: App, plugin: HandwritingToTextPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("hwt-settings");

		new Setting(containerEl)
			.setName("API key")
			.setDesc(
				"Get a free key at aistudio.google.com"
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your API key")
					.setValue(this.plugin.settings.geminiApiKey)
					.then((t) => {
						t.inputEl.type = "password";
						t.inputEl.addClass("hwt-settings-wide-input");
					})
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Which model to use for text extraction")
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

		// Advanced settings behind a disclosure
		const advancedDetails = containerEl.createEl("details", {
			cls: "hwt-settings-advanced",
		});
		advancedDetails.createEl("summary", {
			text: "Advanced settings",
		});

		new Setting(advancedDetails)
			.setName("Prompt")
			.setDesc("The instruction sent along with the image")
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter your prompt")
					.setValue(this.plugin.settings.ocrPrompt)
					.then((t) => {
						t.inputEl.rows = 6;
						t.inputEl.addClass("hwt-settings-wide-input");
					})
					.onChange(async (value) => {
						this.plugin.settings.ocrPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(advancedDetails)
			.setName("Page separator")
			.setDesc(
				"Separator between pages when processing multiple images"
			)
			.addText((text) =>
				text
					.setPlaceholder("---")
					.setValue(this.plugin.settings.pageSeparator)
					.onChange(async (value) => {
						this.plugin.settings.pageSeparator = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(advancedDetails)
			.setName("Show page numbers")
			.setDesc(
				"Include page numbers in separators (e.g. --- page 1 ---)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showPageNumbers)
					.onChange(async (value) => {
						this.plugin.settings.showPageNumbers = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
