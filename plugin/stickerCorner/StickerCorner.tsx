/*
 * Sticker Corner – Ansicht im Auswahlfenster (Suche, Raster, Vorschau unten).
 */

import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import { useMemo, useState } from "@webpack/common";

import { t } from "./i18n";
import { fileUrl, sendSticker, Sticker, useStickers } from "./store";
import { itemsOf, restartDiscord, runUpdate, useUpdate } from "./updater";

export const cl = classNameFactory("vc-sc-");

interface Props {
    channel: Channel;
    close(): void;
}

function SearchIcon() {
    return (
        <svg className={cl("search-icon")} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M21.7 20.3 17 15.6A8 8 0 1 0 15.6 17l4.7 4.7a1 1 0 0 0 1.4-1.4ZM4 10a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z" />
        </svg>
    );
}

function Tile({ sticker, onSend, onHover }: { sticker: Sticker; onSend(e: React.MouseEvent): void; onHover(s: Sticker | null): void; }) {
    return (
        <button
            className={cl("tile")}
            onClick={onSend}
            onMouseEnter={() => onHover(sticker)}
            onFocus={() => onHover(sticker)}
            aria-label={sticker.name}
        >
            <img src={fileUrl(sticker)} alt={sticker.name} loading="lazy" draggable={false} />
        </button>
    );
}

function Section({ title, stickers, ...rest }: { title: string; stickers: Sticker[]; onSend(s: Sticker, e: React.MouseEvent): void; onHover(s: Sticker | null): void; }) {
    if (!stickers.length) return null;
    return (
        <section className={cl("section")}>
            <h3 className={cl("section-title")}>{title}</h3>
            <div className={cl("grid")}>
                {stickers.map(s => (
                    <Tile key={s.id} sticker={s} onSend={e => rest.onSend(s, e)} onHover={rest.onHover} />
                ))}
            </div>
        </section>
    );
}

function UpdateBanner() {
    const { available, latest, status, error, news } = useUpdate();
    const [open, setOpen] = useState(false);
    if (!available && status === "idle") return null;

    let action: React.ReactNode;
    if (status === "updating") action = <span className={cl("update-busy")}>{t("updating")}</span>;
    else if (status === "done") action = <button className={cl("update-btn")} onClick={restartDiscord}>{t("restart")}</button>;
    else action = <button className={cl("update-btn")} onClick={runUpdate}>{status === "error" ? t("retry") : t("updateNow")}</button>;

    return (
        <div className={cl("update")}>
            <div className={cl("update-row")}>
                <div className={cl("update-text")}>
                    <b>{status === "done" ? t("updateInstalled") : t("updateAvailable", { v: latest ?? "" })}</b>
                    {news.length > 0 && status !== "done" && (
                        <button className={cl("update-link")} onClick={() => setOpen(o => !o)}>
                            {open ? t("less") : t("whatsNew")}
                        </button>
                    )}
                </div>
                {action}
            </div>
            {status === "error" && <div className={cl("update-error")}>{error}</div>}
            {open && (
                <ul className={cl("update-news")}>
                    {news.flatMap(n => itemsOf(n).map((item, i) => <li key={n.version + i}>{item}</li>))}
                </ul>
            )}
        </div>
    );
}

export function StickerCornerPanel({ channel, close }: Props) {
    const { stickers, recent, loaded, failed } = useStickers();
    const [query, setQuery] = useState("");
    const [hovered, setHovered] = useState<Sticker | null>(null);

    const q = query.trim().toLowerCase();
    const filtered = useMemo(
        () => q ? stickers.filter(s => s.name.toLowerCase().includes(q) || s.author.toLowerCase().includes(q)) : stickers,
        [stickers, q]
    );

    const onSend = (s: Sticker, e: React.MouseEvent) => {
        sendSticker(s, channel.id);
        // Mit Shift bleibt das Fenster offen, wie bei Discords Emojis
        if (!e.shiftKey) close();
    };

    let body: React.ReactNode;
    if (!loaded) {
        body = <div className={cl("empty")}>{t("loading")}</div>;
    } else if (failed && !stickers.length) {
        body = <div className={cl("empty")}>{t("serverDown")}</div>;
    } else if (!stickers.length) {
        body = <div className={cl("empty")}>{t("empty")}</div>;
    } else if (!filtered.length) {
        body = <div className={cl("empty")}>{t("noResults", { q: query })}</div>;
    } else {
        body = (
            <>
                {!q && <Section title={t("recent")} stickers={recent} onSend={onSend} onHover={setHovered} />}
                <Section title={q ? t("results", { n: filtered.length }) : t("all", { n: stickers.length })} stickers={filtered} onSend={onSend} onHover={setHovered} />
            </>
        );
    }

    return (
        <div id="vc-stickercorner-panel" role="tabpanel" aria-labelledby="vc-stickercorner-tab" className={cl("panel")}>
            <UpdateBanner />
            <div className={cl("header")}>
                <label className={cl("search")}>
                    <SearchIcon />
                    <input
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.currentTarget.value)}
                        placeholder={t("searchPlaceholder")}
                        spellCheck={false}
                    />
                </label>
            </div>
            <div className={cl("scroller")} onMouseLeave={() => setHovered(null)}>
                {body}
            </div>
            <div className={cl("footer")}>
                {hovered ? (
                    <>
                        <img className={cl("footer-img")} src={fileUrl(hovered)} alt="" />
                        <div className={cl("footer-text")}>
                            <div className={cl("footer-name")}>{hovered.name}</div>
                            {hovered.author && <div className={cl("footer-author")}>{t("by", { name: hovered.author })}</div>}
                        </div>
                    </>
                ) : (
                    <div className={cl("footer-brand")}>,, Sticker Corner ,,</div>
                )}
            </div>
        </div>
    );
}
