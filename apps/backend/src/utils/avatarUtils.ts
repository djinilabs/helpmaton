/**
 * Utility functions for avatar management
 * Hard-coded list of available avatar logos (helpmaton_logo_1.svg through helpmaton_logo_41.svg)
 */

const AVAILABLE_AVATARS: string[] = Array.from({ length: 41 }, (_, i) => {
  const num = i + 1;
  return `/images/helpmaton_logo_${num}.svg`;
});

/**
 * Get all available avatar paths
 */
export function getAvailableAvatars(): string[] {
  return [...AVAILABLE_AVATARS];
}

/**
 * Get a random avatar from the available list
 */
export function getRandomAvatar(): string {
  const randomIndex = Math.floor(Math.random() * AVAILABLE_AVATARS.length);
  return AVAILABLE_AVATARS[randomIndex]!;
}

/**
 * Get default avatar (first in the list)
 */
export function getDefaultAvatar(): string {
  return AVAILABLE_AVATARS[0]!;
}

/**
 * Validate if an avatar path is in the allowed list
 */
export function isValidAvatar(avatar: string): boolean {
  return AVAILABLE_AVATARS.includes(avatar);
}

