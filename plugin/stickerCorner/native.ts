/*
 * Sticker Corner – läuft im Hauptprozess von Discord.
 * Erlaubt dem Plugin, Liste und Bilder vom Sticker-Server zu laden (Content-Security-Policy).
 */

import { CspPolicies, ImageSrc } from "@main/csp";

CspPolicies["stickers.finalstate.de"] = ImageSrc;
