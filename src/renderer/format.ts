// Clock times shown in the renderer, in her locale.
const HOUR_MINUTE = { hour: '2-digit', minute: '2-digit' } as const;
const WITH_SECONDS = { ...HOUR_MINUTE, second: '2-digit' } as const;

export const timeOf = (at: number | string, withSeconds = false): string => new Date(at).toLocaleTimeString([], withSeconds ? WITH_SECONDS : HOUR_MINUTE);
