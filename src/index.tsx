import { findByProps, findByName } from "@vendetta/metro";
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
function mergeIntoRequest(req: any) {
    try {
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
    } catch (e) {
        logger.error("[RoleUtilities] merge failed", e);
    }
}

// The extra UI injected into the role scene
function RoleExtras({ guildId }: { guildId?: string }) {
    const gid = guildId ?? SelectedGuildStore?.getGuildId?.();
    const canGradient = boostTier(gid) >= 3 || guildHasFeature(gid, "ENHANCED_ROLE_COLORS");
    const canIcon = boostTier(gid) >= 2 || guildHasFeature(gid, "ROLE_ICONS");

    const [style, setStyle] = React.useState(STYLE.SOLID);
    const [solid, setSolid] = React.useState("#5865F2");
    const [c1, setC1] = React.useState("#5865F2");
    const [c2, setC2] = React.useState("#EB459E");
    const [iconUrl, setIconUrl] = React.useState("");
    const [icon, setIcon] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [openPicker, setOpenPicker] = React.useState<null | "solid" | "c1" | "c2">(null);

    // keep the shared state in sync; clear on unmount
    React.useEffect(() => { pending = { style, solid, c1, c2, icon }; }, [style, solid, c1, c2, icon]);
    React.useEffect(() => () => { pending = null; }, []);

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
                {open && <ColorPicker title={label} value={color} onChange={set} />}
            </View>
        );
    }

    return (
        <View style={{
            backgroundColor: "#1e1f22", marginHorizontal: 16, marginVertical: 16,
            borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
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
                Applied automatically when you save the role.
            </Text>
        </View>
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

// Walk the returned tree: find a scroll container to append into
const SCROLL_NAME = /scroll|flatlist|sectionlist/i;
function typeName(t: any): string {
    return (typeof t === "string" ? t : nameOf(t)) ?? "";
}
function findScroll(node: any, depth = 0): any {
    if (!node || typeof node !== "object" || depth > 25) return null;
    if (Array.isArray(node)) {
        for (const n of node) { const r = findScroll(n, depth + 1); if (r) return r; }
        return null;
    }
    if (node.props && SCROLL_NAME.test(typeName(node.type))) return node;
    if (node.props?.children) return findScroll(node.props.children, depth + 1);
    return null;
}
function dumpTree(node: any, depth = 0, out: string[] = []): string[] {
    if (!node || typeof node !== "object" || depth > 7 || out.length > 60) return out;
    if (Array.isArray(node)) { node.forEach((n) => dumpTree(n, depth, out)); return out; }
    if (node.type) out.push(`${"  ".repeat(depth)}${typeName(node.type) || "?"}`);
    if (node.props?.children) dumpTree(node.props.children, depth + 1, out);
    return out;
}

let dumped = false;
function injectInto(ret: any, props: any) {
    if (!ret) return ret;
    if (!dumped) {
        dumped = true;
        record("tree", "\n" + dumpTree(ret).join("\n"));
        record("props", Object.keys(props ?? {}).join(","));
    }
    const extras = React.createElement(RoleExtras, { key: "roleutils-extras", guildId: props?.guildId });
    const scroll = findScroll(ret);

    try {
        if (scroll) {
            if (scroll.props.data && scroll.props.renderItem) {
                // list-style container
                const Old = scroll.props.ListFooterComponent;
                scroll.props.ListFooterComponent = () => (
                    <View>
                        {Old ? (typeof Old === "function" ? <Old /> : Old) : null}
                        {extras}
                    </View>
                );
            } else {
                const kids = scroll.props.children;
                const arr = Array.isArray(kids) ? [...kids] : kids != null ? [kids] : [];
                if (!arr.some((k: any) => k?.key === "roleutils-extras")) arr.push(extras);
                scroll.props.children = arr;
            }
            return ret;
        }
    } catch (e) {
        logger.error("[RoleUtilities] inject failed, using fallback", e);
    }

    // fallback: show our section under the scene in its own scroll area
    return (
        <View style={{ flex: 1 }}>
            <View style={{ flex: 1 }}>{ret}</View>
            <ScrollView style={{ maxHeight: 340 }}>{extras}</ScrollView>
        </View>
    );
}

function patchScene(name: string): (() => void) | null {
    const mod = findByName(name, false);
    if (!mod) { record("scene", `${name}: not found`); return null; }
    if (typeof mod.default === "function") {
        record("scene", `${name}: patching default`);
        return after("default", mod, (args: any[], ret: any) => injectInto(ret, args[0]));
    }
    record("scene", `${name}: found but default is ${typeof mod.default}`);
    return null;
}

let patches: (() => void)[] = [];

export default {
    settings: Settings,
    onLoad() {
        patches.push(after("openLazy", ActionSheet, ([, key]) => { record("openLazy", String(key)); }));

        for (const name of SCENES) {
            try {
                const p = patchScene(name);
                if (p) patches.push(p);
            } catch (e) {
                record("scene", `${name}: patch threw ${String(e)}`);
            }
        }

        patches.push(before("post", RestAPI, ([req]: any[]) => mergeIntoRequest(req)));
        patches.push(before("patch", RestAPI, ([req]: any[]) => mergeIntoRequest(req)));
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
