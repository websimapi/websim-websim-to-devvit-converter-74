// Helper: Clean Filename
export const cleanName = (name) => {
    const parts = name.toLowerCase().split('.');
    const ext = parts.length > 1 ? parts.pop() : '';
    const base = parts.join('.');
    // Allow a-z, 0-9, and underscore. Replace others with hyphen.
    const cleanBase = base.replace(/[^a-z0-9_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return ext ? `${cleanBase}.${ext}` : cleanBase;
};

export function uint8ToString(u8) {
  if (typeof u8 === 'string') return u8;
  if (!(u8 instanceof Uint8Array)) return String(u8 ?? '');
  return new TextDecoder().decode(u8);
}