/*
 * Sticker Corner
 * Eigener Reiter im Auswahlfenster (GIFs · Sticker · Emojis · Sticker Corner).
 * Bilder kommen aus einem Discord-Channel über den Sticker-Server und werden
 * per Klick als normaler Bild-Upload gesendet.
 */

import "./style.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { ExpressionPickerStore } from "@webpack/common";
import type { ComponentType, ReactNode } from "react";

import { settings } from "./settings";
import { cl, StickerCornerPanel } from "./StickerCorner";
import { start, stop } from "./store";
import { startUpdater, stopUpdater } from "./updater";
import { VERSION } from "./version";

const VIEW = "stickercorner";

interface PanelArgs {
    activeView: string;
    channel: Channel;
    close?(): void;
}

export default definePlugin({
    name: "StickerCorner",
    description: `Adds a “Sticker Corner” tab to the sticker picker: images from the sticker channel, sent with one click. Version ${VERSION}`,
    authors: [{ name: "verfremdet", id: 0n }],
    settings,

    patches: [
        {
            find: ".EXPRESSION_PICKER_TAB_CLICKED,{tab:",
            replacement: [
                {
                    // Reiter hinter „Emojis“ einhängen. Holt sich dabei Discords Tab-Komponente und den aktiven Reiter.
                    match: /(\(0,\i\.jsx\)\((\i),\{id:\i\.\i,"aria-controls":\i\.\i,"aria-selected":(\i)===\i\.\i\.EMOJI.{0,2000}?role:"tablist".{0,120}?children:\[\i,\i,\i)/,
                    replace: "$1,$self.renderTab($2,$3)"
                },
                {
                    // Eigene Ansicht vor der Sticker-Ansicht einfügen.
                    match: /:null,(?=(\i)===\i\.\i\.STICKER&&\i\?\(0,\i\.jsx\)\(\i,\{isLoading:\i,channel:(\i),containerWidth:\i,onSelectSticker:\i,closePopout:(\i))/,
                    replace: ":null,$self.renderPanel({activeView:$1,channel:$2,close:$3}),"
                }
            ]
        }
    ],

    renderTab(Tab: ComponentType<any>, activeView: string): ReactNode {
        const active = activeView === VIEW;
        return (
            <Tab
                key="vc-stickercorner"
                id="vc-stickercorner-tab"
                aria-controls="vc-stickercorner-panel"
                aria-selected={active}
                isActive={active}
                viewType={VIEW}
            >
                <span className={cl("tab-label")}>Sticker Corner</span>
            </Tab>
        );
    },

    renderPanel({ activeView, channel, close }: PanelArgs): ReactNode {
        if (activeView !== VIEW || !channel) return null;
        return (
            <ErrorBoundary key="vc-stickercorner-panel" noop>
                <StickerCornerPanel
                    channel={channel}
                    close={close ?? (() => ExpressionPickerStore.closeExpressionPicker())}
                />
            </ErrorBoundary>
        );
    },

    start() {
        start();
        startUpdater();
    },
    stop() {
        stop();
        stopUpdater();
    },
});
