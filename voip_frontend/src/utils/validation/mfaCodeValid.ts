export default function mfaCodeValid(code: string) {
    if (!code.trim()) return false;
    if (!/^[0-9a-f]{32}$/.test(code)) {
        return false;
    }
    return true;
}