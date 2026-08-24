/**
 * Default Silhouette Avatar generator for AeroCord.
 * Generates an SVG Data URI featuring a modern minimalist person silhouette
 * with a customizable background color.
 */
export const DEFAULT_AVATAR_COLORS = [
  '%235865F2', // Aero Discord Blue
  '%2323A55A', // Emerald
  '%23F23F43', // Rose
  '%23FEE75C', // Amber
  '%23EB459E', // Fuchsia
  '%2357F287', // Mint
  '%2300A8FC', // Cyan
  '%239B59B6'  // Purple
];

export const getBlankSilhouetteAvatar = (seed?: string): string => {
  let color = DEFAULT_AVATAR_COLORS[0];
  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % DEFAULT_AVATAR_COLORS.length;
    color = DEFAULT_AVATAR_COLORS[index];
  }
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='${color}'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%23ffffff'/%3E%3Cpath d='M22 84c0-15.464 12.536-28 28-28s28 12.536 28 28' fill='%23ffffff'/%3E%3C/svg%3E`;
};

export const DEFAULT_SILHOUETTE_AVATAR = getBlankSilhouetteAvatar();
