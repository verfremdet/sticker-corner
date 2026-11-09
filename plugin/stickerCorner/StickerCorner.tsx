/*
 * Sticker Corner – view inside the picker (search, favorites, grid, preview at the bottom).
 */

import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import { useLayoutEffect, useMemo, useRef, useState } from "@webpack/common";

import { t } from "./i18n";
import { sendSticker, smallUrl, Sticker, toggleFavorite, useStickers } from "./store";
import { dismissWhatsNew, itemsOf, restartDiscord, runUpdate, useUpdate, useWhatsNew } from "./updater";
import { VERSION } from "./version";

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

function StarIcon({ filled }: { filled: boolean; }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill={filled ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.1l-5.6 3 1.1-6.3L2.9 9.4l6.3-.9L12 2.8z"
            />
        </svg>
    );
}

interface TileHandlers {
    onSend(s: Sticker, e: React.MouseEvent): void;
    onHover(s: Sticker | null): void;
    isFavorite(id: string): boolean;
}

function Tile({ sticker, onSend, onHover, isFavorite }: TileHandlers & { sticker: Sticker; }) {
    const fav = isFavorite(sticker.id);
    const label = sticker.name || "Sticker";
    return (
        <div className={cl("cell", fav && "cell-fav")} onMouseEnter={() => onHover(sticker)}>
            <button
                className={cl("tile")}
                onClick={e => onSend(sticker, e)}
                onContextMenu={e => { e.preventDefault(); toggleFavorite(sticker.id); }}
                onFocus={() => onHover(sticker)}
                aria-label={label}
            >
                <img src={smallUrl(sticker)} alt={label} loading="lazy" draggable={false} />
            </button>
            <button
                className={cl("star")}
                onClick={() => toggleFavorite(sticker.id)}
                aria-label={fav ? t("removeFavorite") : t("addFavorite")}
                title={fav ? t("removeFavorite") : t("addFavorite")}
            >
                <StarIcon filled={fav} />
            </button>
        </div>
    );
}

function Section({ title, stickers, ...handlers }: TileHandlers & { title: string; stickers: Sticker[]; }) {
    if (!stickers.length) return null;
    return (
        <section className={cl("section")}>
            <h3 className={cl("section-title")}>{title}</h3>
            <div className={cl("grid")}>
                {stickers.map(s => <Tile key={s.id} sticker={s} {...handlers} />)}
            </div>
        </section>
    );
}

function WhatsNewBanner() {
    const { show, items } = useWhatsNew();
    if (!show) return null;
    return (
        <div className={cl("update")}>
            <div className={cl("update-row")}>
                <b>{t("newIn", { v: VERSION })}</b>
                <button className={cl("update-btn")} onClick={dismissWhatsNew}>OK</button>
            </div>
            <ul className={cl("update-news")}>
                {items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
        </div>
    );
}

function UpdateBanner() {
    const { available, latest, status, error, news } = useUpdate();
    if (!available && status === "idle") return <WhatsNewBanner />;

    let action: React.ReactNode;
    if (status === "updating") action = <span className={cl("update-busy")}>{t("updating")}</span>;
    else if (status === "done") action = <button className={cl("update-btn")} onClick={restartDiscord}>{t("restart")}</button>;
    else action = <button className={cl("update-btn")} onClick={runUpdate}>{status === "error" ? t("retry") : t("updateNow")}</button>;

    return (
        <div className={cl("update")}>
            <div className={cl("update-row")}>
                <b>{status === "done" ? t("updateInstalled") : t("updateAvailable", { v: latest ?? "" })}</b>
                {action}
            </div>
            {status === "error" && <div className={cl("update-error")}>{error}</div>}
            {status !== "done" && news.length > 0 && (
                <ul className={cl("update-news")}>
                    {news.flatMap(n => itemsOf(n).map((item, i) => <li key={n.version + i}>{item}</li>))}
                </ul>
            )}
            {status === "done" && <div className={cl("update-hint")}>{t("restartHint")}</div>}
        </div>
    );
}

export function StickerCornerPanel({ channel, close }: Props) {
    const { stickers, recent, favorites, isFavorite, loaded, failed } = useStickers();
    const [query, setQuery] = useState("");
    const [hovered, setHovered] = useState<Sticker | null>(null);

    const q = query.trim().toLowerCase();
    const filtered = useMemo(
        () => q ? stickers.filter(s => s.name.toLowerCase().includes(q) || s.author.toLowerCase().includes(q)) : stickers,
        [stickers, q]
    );

    const onSend = (s: Sticker, e: React.MouseEvent) => {
        sendSticker(s, channel.id);
        // Shift keeps the picker open, like Discord's emojis
        if (!e.shiftKey) close();
    };

    const handlers: TileHandlers = { onSend, onHover: setHovered, isFavorite };

    // Always open at the top (favorites first). Favorites/recent load a moment later and
    // land above "All" – keep pinning to the top until the user scrolls themselves.
    const scrollerRef = useRef<HTMLDivElement>(null);
    const userScrolled = useRef(false);
    useLayoutEffect(() => {
        if (!userScrolled.current && scrollerRef.current) scrollerRef.current.scrollTop = 0;
    }, [loaded, favorites.length, recent.length]);
    useLayoutEffect(() => {
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    }, [q]);
    const markScrolled = () => { userScrolled.current = true; };

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
                {!q && <Section title={t("favorites", { n: favorites.length })} stickers={favorites} {...handlers} />}
                {!q && <Section title={t("recent")} stickers={recent} {...handlers} />}
                <Section title={q ? t("results", { n: filtered.length }) : t("all", { n: stickers.length })} stickers={filtered} {...handlers} />
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
            <div
                ref={scrollerRef}
                className={cl("scroller")}
                onMouseLeave={() => setHovered(null)}
                onWheel={markScrolled}
                onTouchMove={markScrolled}
                onKeyDown={markScrolled}
                onMouseDown={markScrolled}
            >
                {body}
            </div>
            <div className={cl("footer")}>
                {hovered ? (
                    <>
                        <img className={cl("footer-img")} src={smallUrl(hovered)} alt="" />
                        <div className={cl("footer-text")}>
                            <div className={cl("footer-name")}>{hovered.name || "Sticker"}</div>
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
