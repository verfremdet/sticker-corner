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
    autoSteal: {
        type: OptionType.BOOLEAN,
        description: "Take GIFs/stickers you send through Discord's pickers into Sticker Corner by itself, never twice / Über Discords Fenster gesendete GIFs/Sticker von selbst in Sticker Corner übernehmen, nie doppelt",
        default: true,
    },
    stealFavorites: {
        type: OptionType.BOOLEAN,
        description: "Also take your favorite GIFs from Discord's GIF picker (and make them favorites here) / Auch deine Lieblings-GIFs aus Discords GIF-Fenster übernehmen (und hier zu Favoriten machen)",
        default: false,
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
