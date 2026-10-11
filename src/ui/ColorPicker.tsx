import { React, ReactNative } from "@vendetta/metro/common";
import { isValidHex } from "../lib/color";

const { View, Text, TextInput, TouchableOpacity, ScrollView } = ReactNative;

const PRESETS = [
    "#F23F42", "#E67E22", "#F0B232", "#FEE75C",
    "#23A55A", "#1ABC9C", "#3498DB", "#5865F2",
    "#9B59B6", "#EB459E", "#FF6B6B", "#FF9FF3",
    "#FFFFFF", "#99AAB5", "#2C3E50", "#000000",
];

interface ColorPickerProps {
    title: string;
    value: string;
    onChange: (hex: string) => void;
    hideTitle?: boolean;
}

export default function ColorPicker({ title, value, onChange, hideTitle }: ColorPickerProps) {
    const valid = !value || isValidHex(value);
    const swatchColor = isValidHex(value) ? value : "#5865F2";

    return (
        <View style={{ marginVertical: 8 }}>
            {!hideTitle && <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <View
                    style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        backgroundColor: swatchColor,
                        marginRight: 10,
                        borderWidth: 1,
                        borderColor: "rgba(128,128,128,0.4)",
                    }}
                />
                <Text style={{ fontSize: 15, fontWeight: "600", color: "#dbdee1" }}>{title}</Text>
            </View>}

            <TextInput
                value={value}
                placeholder="#5865F2"
                onChangeText={onChange}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor="rgba(128,128,128,0.6)"
                style={{
                    borderWidth: 1,
                    borderColor: valid ? "rgba(128,128,128,0.35)" : "#F23F42",
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    fontSize: 14,
                    color: "#dbdee1",
                    marginBottom: 10,
                }}
            />

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {PRESETS.map((preset) => {
                    const active = value?.toLowerCase() === preset.toLowerCase();
                    return (
                        <TouchableOpacity
                            key={preset}
                            onPress={() => onChange(preset)}
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                backgroundColor: preset,
                                marginRight: 8,
                                marginBottom: 8,
                                borderWidth: active ? 2.5 : 1,
                                borderColor: active ? "#fff" : "rgba(128,128,128,0.35)",
                            }}
                        />
                    );
                })}
            </View>

            {!valid && (
                <Text style={{ color: "#F23F42", fontSize: 12, marginTop: 2 }}>
                    Invalid hex color — use format #RRGGBB
                </Text>
            )}
        </View>
    );
}
