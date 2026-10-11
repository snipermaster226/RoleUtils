import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { React, ReactNative, clipboard } from "@vendetta/metro/common";
import { findInReactTree } from "@vendetta/utils";
import { showToast } from "@vendetta/ui/toasts";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { logger } from "@vendetta";
import ColorPicker from "./ui/ColorPicker";
import { isValidHex, hexToInt } from "./lib/color";

const { View, Text, TouchableOpacity, ScrollView, Switch } = ReactNative;

const RestAPI = findByProps("get", "post", "del", "patch");
const GuildStore = findByProps("getGuild");
const ActionSheet = findByProps("openLazy", "hideActionSheet");

// Role style constants (matching Discord's API)
const ROLE_STYLE = {
    SOLID: 0,
    GRADIENT: 1,
    HOLOGRAPHIC: 2,
};

// Check if server has the required boost tier for a feature
function getServerBoostTier(guildId: string): number {
    const guild = GuildStore?.getGuild?.(guildId);
    return guild?.premiumTier ?? 0;
}

function guildHasFeature(guildId: string, feature: string): boolean {
    const f = GuildStore?.getGuild?.(guildId)?.features;
    if (!f) return false;
    return typeof f.has === "function" ? f.has(feature) : Array.isArray(f) && f.includes(feature);
}

async function updateRole(guildId: string, roleId: string, data: Record<string, any>) {
    try {
        await RestAPI.patch({
            url: `/guilds/${guildId}/roles/${roleId}`,
            body: data,
        });
        showToast("✅ Role updated!", getAssetIDByName("check"));
    } catch (err) {
        logger.error("[RoleUtilities] Failed to update role:", err);
        showToast("❌ Failed to update role.", getAssetIDByName("failure-header"));
    }
}

async function imageToBase64(uri: string): Promise<string> {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// The extra UI injected into the role edit screen
function RoleExtras({ guildId, roleId, initialColor }: { guildId: string; roleId: string; initialColor: number }) {
    const boostTier = getServerBoostTier(guildId);

    const [roleStyle, setRoleStyle] = React.useState<number>(ROLE_STYLE.SOLID);
    const [solidColor, setSolidColor] = React.useState<string>(
        initialColor ? "#" + initialColor.toString(16).padStart(6, "0") : "#5865F2"
    );
    const [gradientColor1, setGradientColor1] = React.useState<string>("#5865F2");
    const [gradientColor2, setGradientColor2] = React.useState<string>("#EB459E");
    const [saving, setSaving] = React.useState(false);

    const canUseGradient = boostTier >= 3 || guildHasFeature(guildId, "ENHANCED_ROLE_COLORS");
    const canUseHolo = canUseGradient;
    const canUseIcon = boostTier >= 2 || guildHasFeature(guildId, "ROLE_ICONS");

    async function handleSave() {
        setSaving(true);
        const body: Record<string, any> = {};

        if (roleStyle === ROLE_STYLE.SOLID && isValidHex(solidColor)) {
            body.color = hexToInt(solidColor);
            body.colors = undefined;
        } else if (roleStyle === ROLE_STYLE.GRADIENT && isValidHex(gradientColor1) && isValidHex(gradientColor2)) {
            body.colors = {
                primary_color: hexToInt(gradientColor1),
                secondary_color: hexToInt(gradientColor2),
            };
        } else if (roleStyle === ROLE_STYLE.HOLOGRAPHIC) {
            body.colors = { primary_color: null, secondary_color: null };
            body.flags = 8; // holographic flag
        }

        await updateRole(guildId, roleId, body);
        setSaving(false);
    }

    return (
        <View style={{
            backgroundColor: "#1e1f22",
            marginHorizontal: 16,
            marginTop: 16,
            borderRadius: 12,
            padding: 16,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
        }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#b5bac1", marginBottom: 12, letterSpacing: 0.5 }}>
                ROLE STYLE (ROLEUTILS)
            </Text>

            {/* Style selector */}
            <View style={{ flexDirection: "row", marginBottom: 16, gap: 8 }}>
                {[
                    { label: "Solid", value: ROLE_STYLE.SOLID, available: true },
                    { label: "Gradient", value: ROLE_STYLE.GRADIENT, available: canUseGradient },
                    { label: "Holographic", value: ROLE_STYLE.HOLOGRAPHIC, available: canUseHolo },
                ].map(({ label, value, available }) => (
                    <TouchableOpacity
                        key={label}
                        onPress={() => available && setRoleStyle(value)}
                        style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            borderWidth: 1.5,
                            borderColor: roleStyle === value ? "#5865F2" : "rgba(128,128,128,0.3)",
                            backgroundColor: roleStyle === value ? "rgba(88,101,242,0.15)" : "transparent",
                            opacity: available ? 1 : 0.4,
                            alignItems: "center",
                        }}
                    >
                        <Text style={{
                            fontSize: 12,
                            fontWeight: "600",
                            color: roleStyle === value ? "#5865F2" : "#b5bac1",
                        }}>
                            {label}
                        </Text>
                        {!available && (
                            <Text style={{ fontSize: 9, color: "#f0b232", marginTop: 2 }}>
                                Boost needed
                            </Text>
                        )}
                    </TouchableOpacity>
                ))}
            </View>

            {/* Color pickers based on style */}
            {roleStyle === ROLE_STYLE.SOLID && (
                <ColorPicker
                    title="Role Color"
                    value={solidColor}
                    onChange={setSolidColor}
                />
            )}

            {roleStyle === ROLE_STYLE.GRADIENT && (
                <>
                    <ColorPicker
                        title="Gradient Start"
                        value={gradientColor1}
                        onChange={setGradientColor1}
                    />
                    <View style={{ height: 12 }} />
                    <ColorPicker
                        title="Gradient End"
                        value={gradientColor2}
                        onChange={setGradientColor2}
                    />
                </>
            )}

            {roleStyle === ROLE_STYLE.HOLOGRAPHIC && (
                <View style={{ paddingVertical: 8 }}>
                    <Text style={{ color: "#b5bac1", fontSize: 13 }}>
                        Holographic roles use a special animated effect managed by Discord.
                        No color selection needed.
                    </Text>
                </View>
            )}

            {/* Save button */}
            <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                style={{
                    marginTop: 16,
                    backgroundColor: saving ? "rgba(88,101,242,0.4)" : "#5865F2",
                    borderRadius: 8,
                    paddingVertical: 10,
                    alignItems: "center",
                }}
            >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                    {saving ? "Saving..." : "Apply Role Style"}
                </Text>
            </TouchableOpacity>
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
                Discovery log
            </Text>
            <Text style={{ color: "#b5bac1", marginBottom: 12 }}>
                Open Server Settings → Roles → Create Role, come back here, press Refresh, then send me this list.
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

let patches: (() => void)[] = [];

export default {
    settings: Settings,
    onLoad() {
        // Patch the role edit action sheet / screen
        // discovery: every lazy sheet key
        patches.push(after("openLazy", ActionSheet, ([, key]) => { record("openLazy", String(key)); }));

        // discovery: every rendered component whose name looks role-related
        try {
            patches.push(after("createElement", React, ([type]: any[]) => {
                const n = nameOf(type);
                if (n && NAME_FILTER.test(n)) record("component", n);
            }));
        } catch (e) { logger.error("[RoleUtilities] createElement patch failed", e); }
        try {
            const jsxRt = findByProps("jsx", "jsxs");
            if (jsxRt) {
                for (const fn of ["jsx", "jsxs"]) {
                    patches.push(after(fn, jsxRt, ([type]: any[]) => {
                        const n = nameOf(type);
                        if (n && NAME_FILTER.test(n)) record("component", n);
                    }));
                }
            }
        } catch (e) { logger.error("[RoleUtilities] jsx patch failed", e); }

        const unpatch = after("openLazy", ActionSheet, ([comp, args, ctx]) => {
            if (args !== "GuildRoleEditActionSheet" && args !== "RoleEditActionSheet") return;

            const guildId = ctx?.guildId ?? ctx?.guild_id;
            const roleId = ctx?.roleId ?? ctx?.role_id ?? ctx?.role?.id;
            const initialColor = ctx?.role?.color ?? 0;

            if (!guildId || !roleId) return;

            comp.then((instance: any) => {
                const unpatchComp = after("default", instance, (_: any, component: any) => {
                    React.useEffect(() => () => { unpatchComp(); }, []);

                    const scrollView = findInReactTree(
                        component,
                        (c: any) => c?.type === ReactNative.ScrollView || c?.type?.displayName === "ScrollView"
                    );

                    if (!scrollView?.props?.children) return;

                    const children = Array.isArray(scrollView.props.children)
                        ? scrollView.props.children
                        : [scrollView.props.children];

                    children.push(
                        React.createElement(RoleExtras, {
                            key: "role-utilities-extras",
                            guildId,
                            roleId,
                            initialColor,
                        })
                    );

                    scrollView.props.children = children;
                });
            });
        });

        patches.push(unpatch);
        logger.log("[RoleUtilities] Loaded.");
    },

    onUnload() {
        for (const unpatch of patches) unpatch();
        patches = [];
        logger.log("[RoleUtilities] Unloaded.");
    },
};
