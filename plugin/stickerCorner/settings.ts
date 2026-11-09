import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        description: "Language / Sprache",
        options: [
            { label: "Automatic (like Discord) / Automatisch (wie Discord)", value: "auto", default: true },
            { label: "English", value: "en" },
            { label: "Deutsch", value: "de" },
        ],
    },
    sendSize: {
        type: OptionType.SELECT,
        description: "Size of sent stickers / Größe gesendeter Sticker",
        options: [
            { label: "Sticker size (max. 224 px) / Sticker-Größe", value: "small", default: true },
            { label: "Original size / Originalgröße", value: "original" },
        ],
    },
    fitsBar: {
        type: OptionType.BOOLEAN,
        description: "✨ Fits right now above the message box / Passt gerade über dem Eingabefeld",
        default: true,
    },
    sounds: {
        type: OptionType.BOOLEAN,
        description: "Sounds (slot machine, ticket helper) / Klänge",
        default: true,
    },
    soundVolume: {
        type: OptionType.SLIDER,
        description: "Sound volume / Lautstärke",
        markers: [0, 25, 50, 75, 100],
        default: 60,
        stickToMarkers: false,
    },
    serverUrl: {
        type: OptionType.STRING,
        description: "Sticker server address",
        default: "https://stickers.verfremdet.com",
        restartNeeded: true,
    },
});
