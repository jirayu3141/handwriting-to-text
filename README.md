# Handwriting to Text

An [Obsidian](https://obsidian.md) plugin that transcribes handwritten pages into text using [Google Gemini](https://ai.google.dev/) AI.

Photograph your handwritten notes, journal entries, or anything on paper — the plugin extracts the text and inserts it directly into your active note at the cursor position.

## Features

- **Scan from file or camera** — pick an image from your device, or use your phone's camera directly on mobile
- **Scan from clipboard** — paste a screenshot or photo you've already copied
- **Select from vault** — choose an image already in your Obsidian vault
- **Drag and drop** — drop an image onto the modal (desktop)
- **Editable preview** — review and edit the extracted text before inserting
- **HEIC support** — iPhone photos (HEIC format) are automatically converted for preview on desktop
- **Thai and multilingual support** — faithfully transcribes non-English handwriting
- **Customizable prompt** — tweak the OCR instructions to suit your handwriting style
- **Works on mobile** — fully functional on iOS and Android Obsidian

## How to use

1. Open any note in the editor
2. Place your cursor where you want the text inserted
3. Trigger the plugin via:
   - The **camera icon** in the left sidebar ribbon, or
   - The command palette: **"Handwriting to Text: Scan handwriting"**, or
   - The command palette: **"Handwriting to Text: Scan from clipboard"**
4. Select or photograph your handwritten page
5. Review the transcription, edit if needed
6. Click **"Insert into Note"**

## Setup

1. Install the plugin from Obsidian's Community Plugins
2. Enable it in Settings > Community Plugins
3. Go to Settings > Handwriting to Text
4. Paste your **Google Gemini API key** (get one free at [Google AI Studio](https://aistudio.google.com/apikey))

## Settings

| Setting | Description |
|---------|-------------|
| **Gemini API key** | Your Google AI Studio API key |
| **Model** | Which Gemini model to use (default: Gemini 2.5 Flash) |
| **OCR prompt** | The instruction sent alongside the image — customize for your handwriting style or language |

## Supported models

- Gemini 3 Flash (preview)
- Gemini 3 Pro (preview)
- Gemini 2.5 Flash (default, recommended)
- Gemini 2.5 Flash Lite (fastest, cheapest)
- Gemini 2.5 Pro (highest quality)

## Privacy

- Images are sent to Google's Gemini API for processing. No data is stored by this plugin.
- Your API key is stored locally in your vault's plugin data folder.
- No telemetry or analytics are collected.

## License

[MIT](LICENSE)

