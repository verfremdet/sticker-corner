/*
 * Sticker Corner – "Add to Sticker Corner" in the right-click menu of images.
 * Only shown to people who may post images in the sticker channel.
 * Asks for a name, then posts the image there (the server picks it up like any other post).
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { RenderModalProps } from "@vencord/discord-types";
import { Menu, Modal, openModal, useState } from "@webpack/common";

import { t } from "./i18n";
import { cl } from "./StickerCorner";
import { addToCorner, canPost, renameSticker, smallUrl, Sticker } from "./store";

const MEDIA_RE = /\.(png|jpe?g|gif|webp|mp4|webm|mov)(?:$|\?)/i;
const HOST_RE = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net|media\.tenor\.com)\//;

/** Pencil on a tile: rename the sticker (= reply in the sticker channel) */
function RenameModal({ sticker, modalProps }: { sticker: Sticker; modalProps: RenderModalProps; }) {
    const [name, setName] = useState(sticker.name);
    const [busy, setBusy] = useState(false);
    const submit = async () => {
        if (busy || !name.trim()) return;
        setBusy(true);
        const ok = await renameSticker(sticker, name);
        setBusy(false);
        if (ok) modalProps.onClose();
    };
    return (
        <Modal
            {...modalProps}
            title={t("renameTitle")}
            actions={[
                { text: t("cancel"), variant: "secondary", onClick: () => modalProps.onClose() },
                { text: busy ? t("adding") : t("renameButton"), variant: "primary", onClick: submit },
            ]}
        >
            <div className={cl("add-body")}>
                <img className={cl("add-preview")} src={smallUrl(sticker)} alt="" />
                <label className={cl("add-label")}>
                    {t("addNameLabel")}
                    <input
                        className={cl("add-input")}
                        autoFocus
                        value={name}
                        maxLength={60}
                        placeholder={t("addNamePlaceholder")}
                        onChange={e => setName(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter") submit(); }}
                    />
                </label>
                <div className={cl("add-note")}>{t("renameNote")}</div>
            </div>
        </Modal>
    );
}

export const openRenameModal = (sticker: Sticker) =>
    openModal(props => <RenameModal sticker={sticker} modalProps={props} />);

/** Name suggestion from the file name, unless it is a hash/"image0" */
function suggestName(src: string): string {
    try {
        const base = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
        if (/^[0-9a-f]{12,}$/i.test(base) || /^(image|unknown|img|file|video)\s?\d*$/i.test(base)) return "";
        return base.replace(/[_-]+/g, " ").trim().slice(0, 60);
    } catch {
        return "";
    }
}

function AddModal({ src, modalProps }: { src: string; modalProps: RenderModalProps; }) {
    const [name, setName] = useState(() => suggestName(src));
    const [busy, setBusy] = useState(false);
    const isVideo = /\.(mp4|webm|mov)(?:$|\?)/i.test(src);

    const submit = async () => {
        if (busy) return;
        setBusy(true);
        const ok = await addToCorner(src, name);
        setBusy(false);
        if (ok) modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            title={t("addTitle")}
            actions={[
                { text: t("cancel"), variant: "secondary", onClick: () => modalProps.onClose() },
                { text: busy ? t("adding") : t("addButton"), variant: "primary", onClick: submit },
            ]}
        >
                <div className={cl("add-body")}>
                    {isVideo
                        ? <video className={cl("add-preview")} src={src} autoPlay muted loop />
                        : <img className={cl("add-preview")} src={src} alt="" />}
                    <label className={cl("add-label")}>
                        {t("addNameLabel")}
                        <input
                            className={cl("add-input")}
                            autoFocus
                            value={name}
                            maxLength={60}
                            placeholder={t("addNamePlaceholder")}
                            onChange={e => setName(e.currentTarget.value)}
                            onKeyDown={e => { if (e.key === "Enter") submit(); }}
                        />
                    </label>
                </div>
        </Modal>
    );
}

function makeItem(src: string) {
    return (
        <Menu.MenuItem
            id="vc-stickercorner-add"
            key="vc-stickercorner-add"
            label={t("addToCorner")}
            action={() => openModal(props => <AddModal src={src} modalProps={props} />)}
        />
    );
}

const usable = (src?: string): src is string => !!src && HOST_RE.test(src) && MEDIA_RE.test(src) && canPost();

/** Right-click on an image/video in a message */
export const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const src = [props?.itemHref, props?.itemSrc].find(u => usable(u));
    if (!src) return;
    const group = findGroupChildrenByChildId("copy-link", children) ?? findGroupChildrenByChildId("copy-native-link", children) ?? children;
    group.push(makeItem(src));
};

/** Right-click on the opened (big) image */
export const imageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!usable(props?.src)) return;
    const group = findGroupChildrenByChildId("copy-native-link", children) ?? children;
    group.push(makeItem(props.src));
};
