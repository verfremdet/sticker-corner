import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    serverUrl: {
        type: OptionType.STRING,
        description: "Adresse des Sticker-Servers",
        default: "https://stickers.finalstate.de",
        restartNeeded: true,
    },
});
