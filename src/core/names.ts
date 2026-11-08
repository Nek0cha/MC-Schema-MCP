/** Names that become file or directory names must stay safe on Windows as well. */
export const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
export const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Returns why the name cannot be used as a file name, or undefined when it is fine. */
export function unsafeNameReason(name: string, label: string): string | undefined {
  if (!SAFE_NAME_PATTERN.test(name)) {
    return `${label} name may contain only letters, digits, spaces, hyphens and underscores.`;
  }
  if (name.endsWith(' ')) return `${label} name must not end with a space.`;
  if (RESERVED_WINDOWS_NAME.test(name)) {
    return `${label} name must not be a reserved Windows device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9).`;
  }
  return undefined;
}

export function assertSafeName(name: string, label: string): void {
  const reason = unsafeNameReason(name, label);
  if (reason) throw new Error(reason);
}
