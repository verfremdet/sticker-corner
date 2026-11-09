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
    serverUrl: {
        type: OptionType.STRING,
        description: "Sticker server address",
        default: "https://stickers.verfremdet.com",
        restartNeeded: true,
    },
});
