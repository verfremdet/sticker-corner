/*
 * Sticker Corner – view inside the picker (search, favorites, grid, preview at the bottom).
 */

import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "@webpack/common";

import { CategoryChip, categoriesOf, categoryLabel as catLabel, chipsFor } from "./categories";
import { t } from "./i18n";
import { openEditModal, openNewCategoryModal } from "./editSticker";
import { sendMessage } from "@utils/discord";

import { openMemeModal } from "./memeText";
import { favoriteGifs, GifItem, markIgnored, suggest } from "./suggest";
import { SlotMachine } from "./slots";
import { canPost, myCount, myTop, prepareSticker, sendSticker, smallUrl, Sticker, toggleFavorite, useStickers, warmBlobs } from "./store";
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
    /** may rename (= may post in the sticker channel) */
    canEdit: boolean;
    onMeme(s: Sticker): void;
}

function PencilIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M14.7 3.3a2.4 2.4 0 0 1 3.4 0l2.6 2.6a2.4 2.4 0 0 1 0 3.4L9.4 20.6a2 2 0 0 1-1 .55l-4.3.95a.9.9 0 0 1-1.07-1.07l.95-4.3a2 2 0 0 1 .55-1zM13.3 7.1 5.9 14.5l-.6 2.9.3.3 2.9-.6 7.4-7.4z" />
        </svg>
    );
}

function Tile({ sticker, onSend, onHover, isFavorite, canEdit, onMeme }: TileHandlers & { sticker: Sticker; }) {
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
            <div className={cl("actions")}>
                <button
                    className={cl("action", "meme")}
                    onClick={() => onMeme(sticker)}
                    aria-label={t("memeOpen")}
                    title={t("memeOpen")}
                >
                    Aa
                </button>
                {(

                    <button
                        className={cl("action", "edit")}
                        onClick={() => openEditModal(sticker)}
                        aria-label={t("rename")}
                        title={t("rename")}
                    >
                        <PencilIcon />
                    </button>
                )}
                <button
                    className={cl("action", "star")}
                    onClick={() => toggleFavorite(sticker.id)}
                    aria-label={fav ? t("removeFavorite") : t("addFavorite")}
                    title={fav ? t("removeFavorite") : t("addFavorite")}
                >
                    <StarIcon filled={fav} />
                </button>
            </div>
        </div>
    );
}

function GifTile({ gif, onSend }: { gif: GifItem; onSend(g: GifItem): void; }) {
    return (
        <div className={cl("cell")}>
            <button className={cl("tile", "tile-gif")} onClick={() => onSend(gif)} aria-label="GIF" title="GIF">
                {gif.video
                    ? <video src={gif.src} autoPlay loop muted playsInline />
                    : <img src={gif.src} alt="GIF" loading="lazy" draggable={false} />}
                <span className={cl("gif-badge")}>GIF</span>
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
    const [showAll, setShowAll] = useState(false);
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
                // only the newest version's news; older ones on request (otherwise the box gets taller than the picker)
                <>
                    <ul className={cl("update-news")}>
                        {(showAll ? news : news.slice(0, 1)).flatMap(n => itemsOf(n).map((item, i) => <li key={n.version + i}>{item}</li>))}
                    </ul>
                    {news.length > 1 && (
                        <button className={cl("update-more")} onClick={() => setShowAll(v => !v)}>
                            {showAll ? t("less") : t("olderNews", { n: news.length - 1 })}
                        </button>
                    )}
                </>
            )}
            {status === "done" && <div className={cl("update-hint")}>{t("restartHint")}</div>}
        </div>
    );
}

function CategoryChips({ chips, active, onPick, onAdd }: { chips: CategoryChip[]; active: string | null; onPick(id: string | null): void; onAdd(): void; }) {
    return (
        <div
            className={cl("chips")}
            role="toolbar"
            // mouse wheel scrolls the row sideways
            onWheel={e => { if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}
        >
            <button className={cl("chip", !active && "chip-active")} onClick={() => onPick(null)}>{t("allCategories")}</button>
            {chips.map(c => (
                <button
                    key={c.id}
                    className={cl("chip", active === c.id && "chip-active")}
                    onClick={() => onPick(active === c.id ? null : c.id)}
                >
                    {c.label}<span className={cl("chip-count")}>{c.count}</span>
                </button>
            ))}
            <button className={cl("chip", "chip-add")} onClick={onAdd} title={t("newCategory")} aria-label={t("newCategory")}>+</button>
        </div>
    );
}

/** Arrow keys: move to the nearest tile in that direction (works across sections and column counts) */
function moveFocus(from: HTMLElement, key: string, root: HTMLElement): HTMLElement | null {
    const tiles = [...root.querySelectorAll<HTMLElement>(".vc-sc-tile")];
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of tiles) {
        if (el === from) continue;
        const b = el.getBoundingClientRect();
        const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
        const ok = key === "ArrowRight" ? dx > 4 && Math.abs(dy) < a.height / 2
            : key === "ArrowLeft" ? dx < -4 && Math.abs(dy) < a.height / 2
                : key === "ArrowDown" ? dy > 4 : dy < -4;
        if (!ok) continue;
        // vertical: prefer the next row, then the closest column
        const score = key === "ArrowDown" || key === "ArrowUp" ? Math.abs(dy) * 1000 + Math.abs(dx) : Math.abs(dx);
        if (score < bestScore) { bestScore = score; best = el; }
    }
    // Right at the end of a row → first tile of the next row (and the reverse for left)
    if (!best && (key === "ArrowRight" || key === "ArrowLeft")) {
        const i = tiles.indexOf(from);
        best = tiles[key === "ArrowRight" ? i + 1 : i - 1] ?? null;
    }
    return best;
}

export function StickerCornerPanel({ channel, close }: Props) {
    const { stickers, popular, recent, favorites, isFavorite, loaded, failed } = useStickers();
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<string | null>(null);
    const [hovered, setHovered] = useState<Sticker | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const q = query.trim().toLowerCase();
    // not memoized: categories can change in place (pencil) – cheap for a few hundred stickers
    const chips = chipsFor(stickers);
    const activeCategory = chips.some(c => c.id === category) ? category : null;
    // search also finds categories ("cats", "#katzen")
    let filtered = stickers;
    if (activeCategory) filtered = filtered.filter(s => categoriesOf(s).includes(activeCategory));
    if (q) {
        const qq = q.replace(/^#/, "");
        filtered = filtered.filter(s => s.name.toLowerCase().includes(qq) || s.author.toLowerCase().includes(qq)
            || categoriesOf(s).some(id => catLabel(id).toLowerCase().includes(qq)));
    }
    const narrowed = !!q || !!activeCategory;
    const categoryLabel = chips.find(c => c.id === activeCategory)?.label;

    const onSend = (s: Sticker, e: React.MouseEvent) => {
        sendSticker(s, channel.id);
        // Shift keeps the picker open, like Discord's emojis
        if (!e.shiftKey) close();
    };

    // Resting on a sticker for a moment already uploads it → the click sends instantly
    const prepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const onHover = (s: Sticker | null) => {
        setHovered(s);
        clearTimeout(prepTimer.current);
        if (s) prepTimer.current = setTimeout(() => prepareSticker(s, channel.id), 60);
    };
    useEffect(() => () => clearTimeout(prepTimer.current), []);

    // The bigger picker must never stick out of the Discord window (small window, ticket bar, reply bar …):
    // measure it and shrink it until the bottom bar with the name is fully visible again.
    useLayoutEffect(() => {
        const wrap = document.querySelector<HTMLElement>('[class*="drawerSizingWrapper"]');
        if (!wrap) return;
        const fit = () => {
            wrap.style.removeProperty("height");
            const r = wrap.getBoundingClientRect();
            const over = Math.max(r.bottom - (window.innerHeight - 8), 8 - r.top, 0);
            if (over > 0) wrap.style.setProperty("height", `${Math.max(320, r.height - over)}px`, "important");
        };
        fit();
        const again = setTimeout(fit, 120); // Discord positions the picker a moment later
        window.addEventListener("resize", fit);
        return () => {
            clearTimeout(again);
            window.removeEventListener("resize", fit);
            wrap.style.removeProperty("height");
        };
    }, []);

    // Picker open: load all small images, and already upload the top favorites/recent → first click is instant
    useEffect(() => {
        if (!loaded || !stickers.length) return;
        warmBlobs([...favorites, ...recent, ...stickers]);
        const top = [...new Map([...favorites, ...recent].map(s => [s.id, s])).values()].slice(0, 4);
        for (const s of top) prepareSticker(s, channel.id);
    }, [loaded, stickers.length > 0, channel.id]);

    const canEdit = useMemo(() => canPost(), [stickers]);
    const onMeme = (s: Sticker) => { openMemeModal(s, channel.id); close(); };
    const handlers: TileHandlers = { onSend, onHover, isFavorite, canEdit, onMeme };
    const [slotOpen, setSlotOpen] = useState(false);

    // ✨ "Fits right now": learned per person from what you sent in similar chat moments
    const fits = useMemo(
        () => loaded && stickers.length ? suggest(channel.id, stickers, favoriteGifs(), myCount) : [],
        [loaded, stickers.length > 0, channel.id]
    );
    const usedFit = useRef(false);
    const fitsRef = useRef(fits);
    fitsRef.current = fits;
    useEffect(() => () => { if (!usedFit.current && fitsRef.current.length) markIgnored(fitsRef.current.map(f => f.key)); }, []);
    const top = myTop();

    // Always open at the top (favorites first). Favorites/recent load a moment later and
    // land above "All" – keep pinning to the top until the user scrolls themselves.
    const scrollerRef = useRef<HTMLDivElement>(null);
    const userScrolled = useRef(false);
    useLayoutEffect(() => {
        if (!userScrolled.current && scrollerRef.current) scrollerRef.current.scrollTop = 0;
    }, [loaded, favorites.length, recent.length]);
    useLayoutEffect(() => {
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    }, [q, activeCategory]);
    const markScrolled = () => { userScrolled.current = true; };

    // Keyboard: ↓ from the search goes into the grid, arrows move, Enter sends, ↑ in the top row goes back to the search
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!e.key.startsWith("Arrow")) return;
        const root = scrollerRef.current;
        const target = e.target as HTMLElement;
        if (!root) return;
        if (target === searchRef.current) {
            if (e.key !== "ArrowDown") return;
            const first = root.querySelector<HTMLElement>(".vc-sc-tile");
            if (!first) return;
            e.preventDefault();
            e.stopPropagation();
            first.focus();
            first.scrollIntoView({ block: "nearest" });
            return;
        }
        if (!target.classList.contains("vc-sc-tile")) return;
        e.preventDefault();
        e.stopPropagation();
        userScrolled.current = true;
        const next = moveFocus(target, e.key, root);
        if (next) {
            next.focus();
            next.scrollIntoView({ block: "nearest" });
        } else if (e.key === "ArrowUp") {
            searchRef.current?.focus();
        }
    };

    let body: React.ReactNode;
    if (!loaded) {
        body = <div className={cl("empty")}>{t("loading")}</div>;
    } else if (failed && !stickers.length) {
        body = <div className={cl("empty")}>{t("serverDown")}</div>;
    } else if (!stickers.length) {
        body = <div className={cl("empty")}>{t("empty")}</div>;
    } else if (!filtered.length) {
        body = <div className={cl("empty")}>{t("noResults", { q: query || categoryLabel || "" })}</div>;
    } else {
        const title = q
            ? t("results", { n: filtered.length })
            : activeCategory
                ? `${categoryLabel} (${filtered.length})`
                : t("all", { n: stickers.length });
        body = (
            <>
                {!narrowed && fits.length > 0 && (
                    <section className={cl("section", "section-fits")}>
                        <h3 className={cl("section-title")}>{t("fitsNow")}</h3>
                        <div className={cl("grid")}>
                            {fits.map(f => f.sticker
                                ? <Tile key={f.key} sticker={f.sticker} {...handlers} onSend={(st, e) => { usedFit.current = true; onSend(st, e); }} />
                                : <GifTile key={f.key} gif={f.gif!} onSend={g => { usedFit.current = true; sendMessage(channel.id, { content: g.url }); close(); }} />)}
                        </div>
                    </section>
                )}
                {!narrowed && <Section title={t("favorites", { n: favorites.length })} stickers={favorites} {...handlers} />}
                {!narrowed && <Section title={t("recent")} stickers={recent} {...handlers} />}
                {!narrowed && <Section title={t("popular")} stickers={popular} {...handlers} />}
                <Section title={title} stickers={filtered} {...handlers} />
            </>
        );
    }

    return (
        <div id="vc-stickercorner-panel" role="tabpanel" aria-labelledby="vc-stickercorner-tab" className={cl("panel")} onKeyDown={onKeyDown}>
            <UpdateBanner />
            <div className={cl("header")}>
                <label className={cl("search")}>
                    <SearchIcon />
                    <input
                        ref={searchRef}
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.currentTarget.value)}
                        placeholder={t("searchPlaceholder")}
                        spellCheck={false}
                    />
                </label>
                <button className={cl("slot-open")} onClick={() => setSlotOpen(true)} title={t("slotOpen")} aria-label={t("slotOpen")}>🎰</button>
            </div>
            <CategoryChips chips={chips} active={activeCategory} onPick={setCategory} onAdd={() => { openNewCategoryModal(stickers); close(); }} />
            <div
                ref={scrollerRef}
                className={cl("scroller")}
                onMouseLeave={() => onHover(null)}
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
                            <div className={cl("footer-author")}>
                                {[hovered.author && t("by", { name: hovered.author }), myCount(hovered.id) > 0 && t("sentByYou", { n: myCount(hovered.id) })].filter(Boolean).join(" · ")}
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className={cl("footer-brand")}>,, Sticker Corner ,,</div>
                        {top && (
                            <div className={cl("footer-top")} title={top.sticker.name}>
                                <img src={smallUrl(top.sticker)} alt="" />
                                {t("yourFavorite", { name: top.sticker.name || "Sticker", n: top.n })}
                            </div>
                        )}
                    </>
                )}
            </div>
            {slotOpen && (
                <SlotMachine
                    stickers={stickers}
                    favorites={favorites}
                    channelId={channel.id}
                    onSend={s => { sendSticker(s, channel.id); setSlotOpen(false); close(); }}
                    onClose={() => setSlotOpen(false)}
                />
            )}
        </div>
    );
}
