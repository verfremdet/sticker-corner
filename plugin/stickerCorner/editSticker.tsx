/*
 * Sticker Corner – pencil: edit name and categories of a sticker, and "+" for a new category.
 * With access to the sticker channel the change counts for everyone (silent reply there),
 * without it the categories are only for you.
 */

import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useState } from "@webpack/common";

import { autoCategoriesOf, categoryChoices, categoryLabel, tagToCategory } from "./categories";
import { lang, t } from "./i18n";
import { cl } from "./StickerCorner";
import { addTagTo, allTags, canPost, cleanTags, editSticker, smallUrl, Sticker, tagsOf } from "./store";

const de = () => lang() === "de";
const TXT = {
    editTitle: () => de() ? "Sticker bearbeiten" : "Edit sticker",
    name: () => de() ? "Name" : "Name",
    categories: () => de() ? "Kategorien" : "Categories",
    auto: () => de() ? "automatisch aus dem Namen" : "automatic from the name",
    newCat: () => de() ? "Neue Kategorie …" : "New category …",
    save: () => de() ? "Speichern" : "Save",
    cancel: () => de() ? "Abbrechen" : "Cancel",
    forAll: () => de()
        ? "Gilt für alle – wird still als Antwort auf das Bild im Sticker-Channel gepostet."
        : "Counts for everyone – posted silently as a reply to the image in the sticker channel.",
    onlyMe: () => de()
        ? "Du kannst nicht in den Sticker-Channel posten – Kategorien gelten nur für dich, der Name bleibt."
        : "You can't post in the sticker channel – categories are only for you, the name stays.",
    addTitle: () => de() ? "Neue Kategorie" : "New category",
    addHint: () => de() ? "Name eingeben und die passenden Sticker antippen" : "Type a name and tap the stickers that fit",
    added: (n: number) => de() ? `${n} Sticker einsortiert` : `${n} stickers added`,
};

/** Category editor: chips to switch on/off, plus a field for a new one */
function TagPicker({ value, onChange, locked }: { value: string[]; onChange(v: string[]): void; locked: string[]; }) {
    const [draft, setDraft] = useState("");
    const choices = new Map<string, string>(); // tag → label
    for (const c of categoryChoices()) choices.set(c.tag, c.label);
    for (const tag of allTags()) if (!choices.has(tag) && !categoryChoices().some(c => c.id === tagToCategory(tag))) choices.set(tag, categoryLabel(`t:${tag}`));
    for (const tag of value) if (!choices.has(tag)) choices.set(tag, categoryLabel(tagToCategory(tag)));

    const has = (tag: string) => value.includes(tag) || value.some(v => tagToCategory(v) === tagToCategory(tag));
    const toggle = (tag: string) => onChange(has(tag) ? value.filter(v => tagToCategory(v) !== tagToCategory(tag)) : [...value, tag]);
    const add = () => {
        const [tag] = cleanTags([draft.replace(/\s+/g, "-")]);
        if (tag && !has(tag)) onChange([...value, tag]);
        setDraft("");
    };

    return (
        <div className={cl("tags")}>
            {[...choices.entries()].map(([tag, label]) => {
                const isLocked = locked.includes(tagToCategory(tag));
                return (
                    <button
                        key={tag}
                        className={cl("tag", (has(tag) || isLocked) && "tag-on", isLocked && "tag-locked")}
                        onClick={() => !isLocked && toggle(tag)}
                        title={isLocked ? TXT.auto() : undefined}
                    >
                        {label}
                    </button>
                );
            })}
            <input
                className={cl("tag-input")}
                value={draft}
                maxLength={24}
                placeholder={TXT.newCat()}
                onChange={e => setDraft(e.currentTarget.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
                onBlur={() => draft.trim() && add()}
            />
        </div>
    );
}

function EditModal({ sticker, modalProps }: { sticker: Sticker; modalProps: RenderModalProps; }) {
    const shared = canPost();
    const [name, setName] = useState(sticker.name);
    const [tags, setTags] = useState<string[]>(() => shared ? [...(sticker.tags ?? [])] : tagsOf(sticker));
    const [busy, setBusy] = useState(false);

    const save = async () => {
        if (busy) return;
        setBusy(true);
        const ok = await editSticker(sticker, name, tags);
        setBusy(false);
        if (ok) modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            title={TXT.editTitle()}
            actions={[
                { text: TXT.cancel(), variant: "secondary", onClick: () => modalProps.onClose() },
                { text: busy ? t("adding") : TXT.save(), variant: "primary", onClick: save },
            ]}
        >
            <div className={cl("add-body")}>
                <img className={cl("add-preview")} src={smallUrl(sticker)} alt="" />
                <label className={cl("add-label")}>
                    {TXT.name()}
                    <input
                        className={cl("add-input")}
                        autoFocus={shared}
                        disabled={!shared}
                        value={name}
                        maxLength={60}
                        onChange={e => setName(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter") save(); }}
                    />
                </label>
                <div className={cl("add-label")}>
                    {TXT.categories()}
                    <TagPicker value={tags} onChange={setTags} locked={autoCategoriesOf({ ...sticker, name })} />
                </div>
                <div className={cl("add-note")}>{shared ? TXT.forAll() : TXT.onlyMe()}</div>
            </div>
        </Modal>
    );
}

export const openEditModal = (sticker: Sticker) =>
    openModal(props => <EditModal sticker={sticker} modalProps={props} />);

/** "+" in the category bar: name a new category and tap the stickers that belong to it */
function NewCategoryModal({ stickers, modalProps }: { stickers: Sticker[]; modalProps: RenderModalProps; }) {
    const [name, setName] = useState("");
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);

    const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const save = async () => {
        const [tag] = cleanTags([name.replace(/\s+/g, "-")]);
        if (!tag || !picked.size || busy) return;
        setBusy(true);
        const n = await addTagTo(stickers.filter(s => picked.has(s.id)), tag);
        setBusy(false);
        showToast({ text: TXT.added(n), variant: "success" });
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            title={TXT.addTitle()}
            actions={[
                { text: TXT.cancel(), variant: "secondary", onClick: () => modalProps.onClose() },
                { text: busy ? t("adding") : `${TXT.save()}${picked.size ? ` (${picked.size})` : ""}`, variant: "primary", onClick: save },
            ]}
        >
            <div className={cl("add-body")}>
                <input
                    className={cl("add-input")}
                    style={{ alignSelf: "stretch" }}
                    autoFocus
                    value={name}
                    maxLength={24}
                    placeholder={TXT.newCat()}
                    onChange={e => setName(e.currentTarget.value)}
                />
                <div className={cl("add-note")}>{TXT.addHint()} · {canPost() ? TXT.forAll() : TXT.onlyMe()}</div>
                <div className={cl("pick-grid")}>
                    {stickers.map(s => (
                        <button key={s.id} className={cl("pick", picked.has(s.id) && "pick-on")} onClick={() => toggle(s.id)} title={s.name}>
                            <img src={smallUrl(s)} alt={s.name} loading="lazy" />
                        </button>
                    ))}
                </div>
            </div>
        </Modal>
    );
}

export const openNewCategoryModal = (stickers: Sticker[]) =>
    openModal(props => <NewCategoryModal stickers={stickers} modalProps={props} />);
