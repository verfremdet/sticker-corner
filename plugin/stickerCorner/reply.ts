/*
 * Sticker Corner – "Reply with a sticker": sets the reply on that message and opens Sticker Corner.
 * The sticker you click is then sent as a reply (sendSticker uses the pending reply).
 */

import { Channel, Message } from "@vencord/discord-types";
import { findLazy } from "@webpack";
import { ChannelStore, ExpressionPickerStore, FluxDispatcher, PermissionsBits, PermissionStore } from "@webpack/common";

import { VIEW } from "./chatButton";

const ChatInputTypes = findLazy(m => m?.NORMAL?.analyticsName === "normal" && m?.EDIT != null);

export function canReplyIn(channel?: Channel | null): boolean {
    if (!channel) return false;
    if (channel.isPrivate()) return true;
    return PermissionStore.can(PermissionsBits.SEND_MESSAGES | PermissionsBits.ATTACH_FILES, channel);
}

export function replyWithSticker(message: Message) {
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!canReplyIn(channel)) return;
    FluxDispatcher.dispatch({
        type: "CREATE_PENDING_REPLY",
        channel,
        message,
        shouldMention: false,
        showMentionToggle: channel.guild_id != null,
    });
    // let the reply bar render first, then open the picker on our tab
    setTimeout(() => ExpressionPickerStore.openExpressionPicker(VIEW as any, ChatInputTypes.NORMAL, channel.id), 30);
}
