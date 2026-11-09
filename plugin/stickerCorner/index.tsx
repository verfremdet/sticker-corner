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

import { StickerCornerChatButton, StickerCornerIcon, VIEW } from "./chatButton";
import { imageContextMenuPatch, messageContextMenuPatch } from "./contextMenu";
import { settings } from "./settings";
import { cl, StickerCornerPanel } from "./StickerCorner";
import { start, stop } from "./store";
import { startUpdater, stopUpdater } from "./updater";
import { isTeam, isTicket, startTickets, stopTickets } from "./tickets/store";
import { TicketBar } from "./tickets/TicketBar";
import { VERSION } from "./version";

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

    chatBarButton: {
        icon: StickerCornerIcon,
        render: StickerCornerChatButton,
    },

    contextMenus: {
        "message": messageContextMenuPatch,
        "image-context": imageContextMenuPatch,
    },

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
        },
        {
            // Ticket helper: own bar above the message box (where "Replying to …" sits)
            find: "selectedAutocompleteInputError:",
            replacement: {
                match: /(let\{channel:(\i),type:(\i),activeCommand:\i,pendingReply:.{0,2500}?)\{stacked:(\i),floating:(\i)\}/,
                replace: "$1($self.addTicketBar($4,$2,$3),{stacked:$4,floating:$5})"
            }
        }
    ],

    addTicketBar(stacked: ReactNode[], channel: Channel, type: any) {
        try {
            // only the normal message box (not threads/edit), only in tickets, only for the team
            if (type?.analyticsName !== "normal") return;
            if (!isTicket(channel) || !isTeam()) return;
            stacked.unshift(
                <ErrorBoundary key="vc-sct-bar" noop>
                    <TicketBar channel={channel} />
                </ErrorBoundary>
            );
        } catch (e) {
            console.error("[StickerCorner] ticket bar:", e);
        }
    },

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
        startTickets();
    },
    stop() {
        stop();
        stopUpdater();
        stopTickets();
    },
});
