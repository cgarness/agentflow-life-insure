/**
 * Pure utility functions for data computations.
 * No mock data dependencies — these work with any data source.
 */

/**
 * Calculate "aging" in days since last contact.
 * Returns 999 if no lastContactedAt is provided.
 */
export function calcAging(lastContactedAt?: string): number {
  if (!lastContactedAt) return 999;
  return Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / 86400000);
}

/**
 * Given a user list and a userId, return a short display name like "Chris G."
 * Falls back to "Unknown" if user is not found.
 */
export function getAgentName(userId: string, users: { id: string; firstName: string; lastName: string }[]): string {
  const u = users.find(u => u.id === userId);
  return u ? `${u.firstName} ${u.lastName[0]}.` : "Unknown";
}

/**
 * Given a user list and a userId, return initials like "CG".
 * Falls back to "??" if user is not found.
 */
export function getAgentInitials(userId: string, users: { id: string; firstName: string; lastName: string }[]): string {
  const u = users.find(u => u.id === userId);
  return u ? `${u.firstName[0]}${u.lastName[0]}` : "??";
}
