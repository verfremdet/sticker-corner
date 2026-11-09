/*
 * Sticker Corner – button in the chat bar (next to gift, GIF, sticker, emoji).
 * Opens the picker directly on the Sticker Corner tab.
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { IconProps } from "@utils/types";
import { ExpressionPickerStore } from "@webpack/common";

import { t } from "./i18n";

export const VIEW = "stickercorner";

/**
 * Peeled sticker with a sparkle – same 24 px grid and single color as Discord's own icons,
 * but clearly different from the regular sticker icon (folded corner + star instead of a face).
 */
export function StickerCornerIcon({ width = 20, height = 20, className }: IconProps) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                fillRule="evenodd"
                d="M7 2h10a5 5 0 0 1 5 5v2L9 22H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm3 3.6 1.45 3.45 3.45 1.45-3.45 1.45L10 15.4l-1.45-3.45L5.1 10.5l3.45-1.45L10 5.6Z"
            />
            <path
                fill="currentColor"
                d="M14 22a8 8 0 0 1 8-8v1.2c0 .5-.2 1-.6 1.4l-5.2 5.2c-.4.4-.9.6-1.4.6H14Z"
            />
        </svg>
    );
}

export const StickerCornerChatButton: ChatBarButtonFactory = ({ type, channel, isAnyChat }) => {
    // only where Discord itself offers the sticker button (not in e.g. thread-creation forms)
    if (!isAnyChat || !type?.stickers?.button) return null;

    return (
        <ChatBarButton
            tooltip={t("openButton")}
            onClick={() => ExpressionPickerStore.toggleExpressionPicker(VIEW, type, channel?.id)}
        >
            <StickerCornerIcon className="vc-sc-chatbutton" />
        </ChatBarButton>
    );
};
