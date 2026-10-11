export const HEX_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidHex(value: string | undefined | null): value is string {
    return !!value && HEX_REGEX.test(value);
}

export function normalizeHex(hex: string): string {
    if (hex.length === 4) {
        return "#" + hex.slice(1).split("").map((c) => c + c).join("");
    }
    return hex;
}

export function hexToInt(hex: string): number {
    return parseInt(normalizeHex(hex).slice(1), 16);
}

export function intToHex(int: number): string {
    return "#" + int.toString(16).padStart(6, "0");
}
