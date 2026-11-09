/*
 * Sticker Corner – put meme text on a sticker (top/bottom, white with black outline) and send it.
 * Drawn in a canvas right here; animated stickers become a still image.
 */

import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, useEffect, useRef, useState } from "@webpack/common";

import { t } from "./i18n";
import { cl } from "./StickerCorner";
import { fileUrlOf, sendFileNow, Sticker } from "./store";

const MAX = 512;
const FONT = '"Impact", "Anton", "Arial Black", sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous"; // server sends CORS * → canvas stays exportable
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

/** Splits text into lines that fit, shrinking the font until it does (max. 3 lines) */
function layout(ctx: CanvasRenderingContext2D, text: string, width: number, start: number) {
    let size = start;
    while (size > 12) {
        ctx.font = `${size}px ${FONT}`;
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = "";
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (ctx.measureText(test).width <= width || !line) line = test;
            else { lines.push(line); line = w; }
        }
        if (line) lines.push(line);
        if (lines.length <= 3 && lines.every(l => ctx.measureText(l).width <= width)) return { size, lines };
        size -= 2;
    }
    return { size, lines: [text] };
}

function draw(canvas: HTMLCanvasElement, img: HTMLImageElement, top: string, bottom: string) {
    const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#000";

    const put = (text: string, fromTop: boolean) => {
        const clean = text.trim().toUpperCase();
        if (!clean) return;
        const { size, lines } = layout(ctx, clean, w * 0.92, Math.round(h / 7));
        ctx.font = `${size}px ${FONT}`;
        ctx.lineWidth = Math.max(2, size / 7);
        const lh = size * 1.05;
        lines.forEach((l, i) => {
            const y = fromTop ? size + 6 + i * lh : h - 10 - (lines.length - 1 - i) * lh;
            ctx.strokeText(l, w / 2, y);
            ctx.fillText(l, w / 2, y);
        });
    };
    put(top, true);
    put(bottom, false);
}

function MemeModal({ sticker, channelId, modalProps }: { sticker: Sticker; channelId: string; modalProps: RenderModalProps; }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [img, setImg] = useState<HTMLImageElement | null>(null);
    const [top, setTop] = useState("");
    const [bottom, setBottom] = useState("");
    const animated = /\.(gif|webp)$/.test(sticker.file);

    useEffect(() => { loadImage(fileUrlOf(sticker)).then(setImg, () => showToast({ text: t("loadFailed"), variant: "critical" })); }, []);
    useEffect(() => { if (img && canvasRef.current) draw(canvasRef.current, img, top, bottom); }, [img, top, bottom]);

    const send = () => {
        const canvas = canvasRef.current;
        if (!canvas || !img) return;
        canvas.toBlob(blob => {
            if (!blob) return;
            const name = (sticker.name || "sticker").replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "_").slice(0, 30) || "sticker";
            sendFileNow(new File([blob], `${name}_meme.png`, { type: "image/png" }), channelId);
            modalProps.onClose();
        }, "image/png");
    };

    const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") send(); };

    return (
        <Modal
            {...modalProps}
            title={t("memeTitle")}
            actions={[
                { text: t("cancel"), variant: "secondary", onClick: () => modalProps.onClose() },
                { text: t("memeSend"), variant: "primary", onClick: send },
            ]}
        >
            <div className={cl("add-body")}>
                <canvas ref={canvasRef} className={cl("meme-canvas")} />
                <input className={cl("add-input", "meme-input")} autoFocus maxLength={80} placeholder={t("memeTop")} value={top} onChange={e => setTop(e.currentTarget.value)} onKeyDown={onKey} />
                <input className={cl("add-input", "meme-input")} maxLength={80} placeholder={t("memeBottom")} value={bottom} onChange={e => setBottom(e.currentTarget.value)} onKeyDown={onKey} />
                {animated && <div className={cl("add-note")}>{t("memeStill")}</div>}
            </div>
        </Modal>
    );
}

export const openMemeModal = (sticker: Sticker, channelId: string) =>
    openModal(props => <MemeModal sticker={sticker} channelId={channelId} modalProps={props} />);
