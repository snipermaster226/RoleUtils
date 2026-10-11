import { findByProps } from "@vendetta/metro";
import { after, before } from "@vendetta/patcher";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { logger } from "@vendetta";
import ColorPicker from "./ui/ColorPicker";
import { isValidHex, hexToInt } from "./lib/color";

const { View, Text, TouchableOpacity, ScrollView, TextInput } = ReactNative;

const RestAPI = findByProps("get", "post", "del", "patch");
const GuildStore = findByProps("getGuild");
const SelectedGuildStore = findByProps("getGuildId", "getLastSelectedGuildId");
const ActionSheet = findByProps("openLazy", "hideActionSheet");

const STYLE = { SOLID: 0, GRADIENT: 1, HOLOGRAPHIC: 2 };

// Discord's fixed values for the holographic style
const HOLO = { primary_color: 11127295, secondary_color: 16759788, tertiary_color: 16761760 };

// Scenes to patch. RoleCreateScene is confirmed from discovery; the others are best guesses.
const SCENES = ["RoleCreateScene", "RoleEditScene", "RoleSettingsScene"];

// ---- state shared between the injected UI and the request interceptor ----
interface Pending {
    style: number;
    solid: string;
    c1: string;
    c2: string;
    icon: string | null; // data URI
}
const DEFAULTS: Pending = { style: 0, solid: "#5865F2", c1: "#5865F2", c2: "#EB459E", icon: null };
let pending: Pending | null = null;

function guildHasFeature(guildId: string | undefined, feature: string): boolean {
    if (!guildId) return false;
    const f = GuildStore?.getGuild?.(guildId)?.features;
    if (!f) return false;
    return typeof f.has === "function" ? f.has(feature) : Array.isArray(f) && f.includes(feature);
}
function boostTier(guildId?: string): number {
    return (guildId && GuildStore?.getGuild?.(guildId)?.premiumTier) || 0;
}

async function urlToDataUri(uri: string): Promise<string> {
    const res = await fetch(uri);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });
}

// Merge our fields into Discord's own create/edit role request
const ROLE_URL = /^\/guilds\/\d+\/roles(\/\d+)?$/;
function mergeIntoRequest(req: any, method = "?") {
    try {
        if (req && typeof req.url === "string" && /roles/.test(req.url)) {
            record("http", `${method} ${req.url.replace(/\d{15,}/g, "{id}")} keys=${Object.keys(req.body ?? {}).join(",")} pending=${!!pending}`);
        }
        if (!pending || !req || typeof req.url !== "string") return;
        if (!ROLE_URL.test(req.url.split("?")[0])) return;
        const body = (req.body = req.body ?? {});
        const p = pending;

        if (p.style === STYLE.SOLID && isValidHex(p.solid)) {
            body.color = hexToInt(p.solid);
        } else if (p.style === STYLE.GRADIENT && isValidHex(p.c1) && isValidHex(p.c2)) {
            body.color = hexToInt(p.c1);
            body.colors = { primary_color: hexToInt(p.c1), secondary_color: hexToInt(p.c2), tertiary_color: null };
        } else if (p.style === STYLE.HOLOGRAPHIC) {
            body.color = HOLO.primary_color;
            body.colors = { ...HOLO };
        }
        if (p.icon) {
            body.icon = p.icon;
            body.unicode_emoji = null;
        }
        record("request", `${req.url} merged style=${p.style} icon=${!!p.icon}`);
        pending = null;
    } catch (e) {
        logger.error("[RoleUtilities] merge failed", e);
    }
}

// The extra UI injected into the role scene
function RoleStyleSheet({ guildId }: { guildId?: string }) {
    const gid = guildId ?? SelectedGuildStore?.getGuildId?.();
    const canGradient = boostTier(gid) >= 3 || guildHasFeature(gid, "ENHANCED_ROLE_COLORS");
    const canIcon = boostTier(gid) >= 2 || guildHasFeature(gid, "ROLE_ICONS");

    const init = pending ?? DEFAULTS;
    const [style, setStyle] = React.useState(init.style);
    const [solid, setSolid] = React.useState(init.solid);
    const [c1, setC1] = React.useState(init.c1);
    const [c2, setC2] = React.useState(init.c2);
    const [iconUrl, setIconUrl] = React.useState("");
    const [icon, setIcon] = React.useState<string | null>(init.icon);
    const [loading, setLoading] = React.useState(false);
    const [openPicker, setOpenPicker] = React.useState<null | "solid" | "c1" | "c2">(null);

    // keep the shared state in sync; clear on unmount
    React.useEffect(() => { pending = { style, solid, c1, c2, icon }; }, [style, solid, c1, c2, icon]);

    async function loadIcon() {
        if (!iconUrl.trim()) return;
        setLoading(true);
        try {
            setIcon(await urlToDataUri(iconUrl.trim()));
            showToast("Icon loaded. It is sent when you save the role.");
        } catch (e) {
            logger.error("[RoleUtilities] icon load failed", e);
            showToast("Could not load that image URL.");
        }
        setLoading(false);
    }

    const cards = [
        { label: "Solid", value: STYLE.SOLID, ok: true },
        { label: "Gradient", value: STYLE.GRADIENT, ok: canGradient },
        { label: "Holographic", value: STYLE.HOLOGRAPHIC, ok: canGradient },
    ];

    function swatch(label: string, key: "solid" | "c1" | "c2", color: string, set: (s: string) => void) {
        const open = openPicker === key;
        return (
            <View key={key} style={{ marginBottom: 8 }}>
                <TouchableOpacity
                    onPress={() => setOpenPicker(open ? null : key)}
                    style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8 }}
                >
                    <View style={{
                        width: 28, height: 28, borderRadius: 8, marginRight: 12,
                        backgroundColor: isValidHex(color) ? color : "#5865F2",
                        borderWidth: 1, borderColor: "rgba(128,128,128,0.4)",
                    }} />
                    <Text style={{ color: "#dbdee1", fontWeight: "600", flex: 1 }}>{label}</Text>
                    <Text style={{ color: "#b5bac1" }}>{color}</Text>
                </TouchableOpacity>
                {open && <ColorPicker title={label} hideTitle value={color} onChange={set} />}
            </View>
        );
    }

    return (
        <ScrollView style={{ maxHeight: 560 }}><View style={{
            backgroundColor: "#1e1f22", padding: 16, paddingBottom: 28,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
        }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#b5bac1", marginBottom: 12, letterSpacing: 0.5 }}>
                ROLE STYLE
            </Text>

            <View style={{ flexDirection: "row", marginBottom: 16 }}>
                {cards.map(({ label, value, ok }) => (
                    <TouchableOpacity
                        key={label}
                        onPress={() => ok && setStyle(value)}
                        style={{
                            flex: 1, marginHorizontal: 4, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5,
                            borderColor: style === value ? "#5865F2" : "rgba(128,128,128,0.3)",
                            backgroundColor: style === value ? "rgba(88,101,242,0.15)" : "transparent",
                            opacity: ok ? 1 : 0.4, alignItems: "center",
                        }}
                    >
                        <Text style={{ fontSize: 12, fontWeight: "600", color: style === value ? "#5865F2" : "#b5bac1" }}>
                            {label}
                        </Text>
                        {!ok && <Text style={{ fontSize: 9, color: "#f0b232", marginTop: 2 }}>Boost needed</Text>}
                    </TouchableOpacity>
                ))}
            </View>

            {style === STYLE.SOLID && swatch("Role color", "solid", solid, setSolid)}
            {style === STYLE.GRADIENT && (<>
                {swatch("Start color", "c1", c1, setC1)}
                {swatch("End color", "c2", c2, setC2)}
            </>)}
            {style === STYLE.HOLOGRAPHIC && (
                <Text style={{ color: "#b5bac1", fontSize: 13 }}>
                    Holographic uses Discord's fixed animated colors. Nothing to pick.
                </Text>
            )}

            {canIcon && (
                <View style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#b5bac1", marginBottom: 8, letterSpacing: 0.5 }}>
                        ROLE ICON
                    </Text>
                    <TextInput
                        value={iconUrl}
                        onChangeText={setIconUrl}
                        placeholder="Direct image URL (png/jpg)"
                        placeholderTextColor="rgba(128,128,128,0.6)"
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={{
                            borderWidth: 1, borderColor: "rgba(128,128,128,0.35)", borderRadius: 8,
                            paddingHorizontal: 12, paddingVertical: 8, color: "#dbdee1", marginBottom: 8,
                        }}
                    />
                    <TouchableOpacity
                        onPress={loadIcon}
                        disabled={loading}
                        style={{ backgroundColor: "#4e5058", borderRadius: 8, paddingVertical: 10, alignItems: "center" }}
                    >
                        <Text style={{ color: "#fff", fontWeight: "700" }}>
                            {loading ? "Loading..." : icon ? "Icon ready. Tap to replace" : "Load icon"}
                        </Text>
                    </TouchableOpacity>
                </View>
            )}

            <Text style={{ color: "#80848e", fontSize: 11, marginTop: 12 }}>
                Applied when you tap Create on the role screen.
            </Text>
            <TouchableOpacity
                onPress={() => { try { ActionSheet.hideActionSheet("RoleUtilsSheet"); } catch { try { ActionSheet.hideActionSheet(); } catch {} } }}
                style={{ marginTop: 12, backgroundColor: "#5865F2", borderRadius: 8, paddingVertical: 12, alignItems: "center" }}
            >
                <Text style={{ color: "#fff", fontWeight: "700" }}>Done</Text>
            </TouchableOpacity>
        </View></ScrollView>
    );
}

// ---- Discovery mode: records what Discord opens so we can find the real role screen ----
const discovered: string[] = [];
function record(kind: string, name: string) {
    const line = `${kind}: ${name}`;
    if (discovered.includes(line)) return;
    discovered.push(line);
    logger.log("[RoleUtilities] " + line);
}
const NAME_FILTER = /role|permission|guildsettings|guild_settings/i;
function nameOf(type: any): string | null {
    if (!type) return null;
    if (typeof type === "string") return null;
    return type.displayName ?? type.name ?? type.type?.displayName ?? type.type?.name ?? type.render?.name ?? null;
}

function Settings() {
    const [, force] = React.useReducer((x: number) => x + 1, 0);
    return (
        <ScrollView style={{ flex: 1, padding: 16 }}>
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 8 }}>
                RoleUtilities log
            </Text>
            <Text style={{ color: "#b5bac1", marginBottom: 12 }}>
                Status log. If the Create Role screen shows no extra section, open Create Role, come back here, press Refresh, Copy all, and send it to me.
            </Text>
            <TouchableOpacity onPress={force} style={{ backgroundColor: "#5865F2", padding: 10, borderRadius: 8, marginBottom: 8 }}>
                <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Refresh</Text>
            </TouchableOpacity>
            <TouchableOpacity
                onPress={() => { try { clipboard.setString(discovered.join("\n")); showToast("Copied"); } catch {} }}
                style={{ backgroundColor: "#4e5058", padding: 10, borderRadius: 8, marginBottom: 12 }}
            >
                <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>Copy all</Text>
            </TouchableOpacity>
            {discovered.length === 0 && <Text style={{ color: "#b5bac1" }}>Nothing recorded yet.</Text>}
            {discovered.map((l, i) => (
                <Text key={i} style={{ color: "#dbdee1", fontSize: 12, marginBottom: 4 }}>{l}</Text>
            ))}
        </ScrollView>
    );
}

function typeName(t: any): string {
    return (typeof t === "string" ? t : nameOf(t)) ?? "";
}
function dumpTree(node: any, depth = 0, out: string[] = []): string[] {
    if (!node || typeof node !== "object" || depth > 7 || out.length > 60) return out;
    if (Array.isArray(node)) { node.forEach((n) => dumpTree(n, depth, out)); return out; }
    if (node.type) out.push(`${"  ".repeat(depth)}${typeName(node.type) || "?"}`);
    if (node.props?.children) dumpTree(node.props.children, depth + 1, out);
    return out;
}
let dumped = false;

// Wrap the scene's component at render time (it is not reachable via findByName)
const SCENE_NAMES = new Set(SCENES);
const wrappers = new WeakMap<any, any>();

function resolveRender(type: any): ((props: any) => any) | null {
    if (!type) return null;
    if (typeof type === "function") {
        return type.prototype?.isReactComponent ? null : (p: any) => type(p);
    }
    if (typeof type === "object") {
        if (typeof type.render === "function") return (p: any) => type.render(p, null); // forwardRef
        if (type.type) return resolveRender(type.type); // memo
    }
    return null;
}

function getWrapper(type: any, name: string) {
    let w = wrappers.get(type);
    if (w !== undefined) return w;
    const render = resolveRender(type);
    if (!render) {
        record("scene", `${name}: cannot wrap (class component or unknown type)`);
        wrappers.set(type, null);
        return null;
    }
    const Wrapped: any = (props: any) => {
        const ret = render(props);
        React.useEffect(() => () => { pending = null; }, []);
        if (!dumped) { dumped = true; record("tree", "\n" + dumpTree(ret).join("\n")); record("props", Object.keys(props ?? {}).join(",")); }
        return ret;
    };
    Wrapped.displayName = name;
    Wrapped.__roleutils = true;
    wrappers.set(type, Wrapped);
    record("scene", `${name}: wrapped`);
    return Wrapped;
}

function swapScene(args: any[]) {
    const type = args[0];
    if (!type || type.__roleutils) return;
    const n = nameOf(type);
    if (!n || !SCENE_NAMES.has(n)) return;
    const w = getWrapper(type, n);
    if (w) return [w, ...args.slice(1)];
}

let patches: (() => void)[] = [];

export default {
    settings: Settings,
    onLoad() {
        patches.push(after("openLazy", ActionSheet, ([, key]) => { record("openLazy", String(key)); }));

        try {
            patches.push(before("createElement", React, swapScene as any));
        } catch (e) { record("scene", "createElement patch failed: " + String(e)); }
        try {
            const jsxRt = findByProps("jsx", "jsxs");
            if (jsxRt) {
                patches.push(before("jsx", jsxRt, swapScene as any));
                patches.push(before("jsxs", jsxRt, swapScene as any));
            } else record("scene", "jsx runtime not found");
        } catch (e) { record("scene", "jsx patch failed: " + String(e)); }

        patches.push(before("openLazy", ActionSheet, (args: any[]) => {
            if (args[1] !== "RoleColorPicker") return;
            const ctx = args[2];
            record("sheet-props", Object.keys(ctx ?? {}).join(","));
            const Sheet = (p: any) => React.createElement(RoleStyleSheet, { guildId: ctx?.guildId ?? p?.guildId });
            return [Promise.resolve({ default: Sheet }), "RoleUtilsSheet", ctx];
        }));

        for (const m of ["post", "patch", "put"]) {
            if (typeof RestAPI?.[m] === "function") {
                patches.push(before(m, RestAPI, ([req]: any[]) => mergeIntoRequest(req, m.toUpperCase())));
            }
        }
        logger.log("[RoleUtilities] Loaded.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        pending = null;
        dumped = false;
        logger.log("[RoleUtilities] Unloaded.");
    },
};
